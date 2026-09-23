import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore, type Session } from '@deepseek-ai/dsh-session';
import { SessionHandleClosedError, type SessionHandle } from '@deepseek-ai/dsh-session-persistence';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { MAX_REQUEST_BYTES, readSession, SessionReaderError, type ReaderErrorCode } from '../src/session_reader.js';

const cliPath = fileURLToPath(new URL('../../dist/session_reader.js', import.meta.url));
const requestId = 'reader-test-request';

function directory(t: TestContext): string {
  const path = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'dsh-reader-'));
  t.after(() => fs.rmSync(path, { recursive: true, force: true }));
  return path;
}

function snapshot(root: string): unknown[] {
  const entries: unknown[] = [];
  const visit = (path: string): void => {
    const stat = fs.lstatSync(path, { bigint: true });
    entries.push([relative(root, path), stat.mtimeNs, stat.isFile() ? fs.readFileSync(path) : null]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(path).sort()) visit(join(path, name));
  };
  visit(root);
  return entries;
}

async function fixture(t: TestContext, compression: 'none' | 'zstd' = 'none') {
  const allowedBase = directory(t);
  const sourceRoot = join(allowedBase, 'nested', 'sessions');
  fs.mkdirSync(sourceRoot, { recursive: true });
  const ctx = new Context();
  new SessionStore(ctx);
  t.after(() => ctx.fiber.dispose());
  const persistence = new JsonlSessionPersistence(ctx, { root: sourceRoot, compression });
  const parent = ctx.sessions.create(SessionId('parent'));
  parent.append('turn/start', { turn: 1 });
  parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const seed = ctx.sessions.create(SessionId('seed'), {
    seed: parent.snapshotEvents(), meta: { cwd: join(allowedBase, 'project', 'nested cwd') },
  });
  const fork = ctx.sessions.fork(parent, undefined, SessionId('child'));
  fork.append('turn/start', { turn: 2 });
  fork.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
  const opaque = ctx.sessions.create(SessionId('../opaque/\\id: 空~%2F'), {
    seed: parent.snapshotEvents(), meta: { cwd: join(allowedBase, 'another project') },
  });
  const empty = ctx.sessions.create(SessionId('empty'));
  const sessions = [parent, seed, fork, opaque, empty];
  for (const session of sessions) {
    const handle = await persistence.create(session.header, { inheritedEventCount: session.inheritedEventCount });
    try {
      await handle.append(session.snapshotEvents());
      await handle.flush();
    } finally {
      await handle.close();
    }
  }
  return { allowedBase, sourceRoot, persistence, parent, seed, fork, opaque, empty, sessions };
}

function hasCode(code: ReaderErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof SessionReaderError && error.code === code
    && !error.message.includes('SECRET');
}

function payload(sessionId: string): Record<string, unknown> {
  return { protocolVersion: 1, requestId, operation: 'read', sessionId };
}

function args(allowedBase: string, sourceRoot: string): string[] {
  return ['--allowed-base', allowedBase, '--source-root', sourceRoot];
}

async function cli(argv: string[], input: string | Buffer, nodeArgs: string[] = [], entryPath = cliPath) {
  const child = spawn(process.execPath, [...nodeArgs, entryPath, ...argv], {
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 20_000, windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); });
  const closed = new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject);
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => {
      if (signal !== null) reject(new Error(`Reader terminated by ${signal}`));
      else resolveExit(code);
    });
  });
  child.stdin.end(input);
  const code = await closed;
  const text = Buffer.concat(stdout).toString('utf8');
  const diagnostics = Buffer.concat(stderr).toString('utf8');
  assert.equal(text.split('\n').length, 2, `expected one stdout line: ${text}; stderr: ${diagnostics}`);
  const envelope = JSON.parse(text) as Record<string, unknown>;
  assert.equal(envelope.protocolVersion, 1);
  return { code, envelope, text, diagnostics };
}

function assertFailure(reply: Awaited<ReturnType<typeof cli>>, code: ReaderErrorCode, id: string | null = requestId): void {
  assert.equal(reply.code, 1);
  assert.equal(reply.envelope.requestId, id);
  assert.equal(reply.envelope.ok, false);
  assert.deepEqual(Object.keys(reply.envelope).sort(), ['error', 'ok', 'protocolVersion', 'requestId']);
  const error = reply.envelope.error as Record<string, unknown>;
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert.deepEqual(Object.keys(error).sort(), ['code', 'message']);
  assert.equal(`${reply.text}${reply.diagnostics}`.includes('SECRET'), false);
  assert.equal(reply.diagnostics.includes(' at '), false);
}

async function assertSession(session: Session, options: { allowedBase: string; sourceRoot: string }): Promise<void> {
  const result = await readSession({ ...options, sessionId: session.id });
  assert.deepEqual(result.header, { ...session.header, delegationDepth: session.header.delegationDepth ?? 0 });
  assert.equal(result.inheritedEventCount, session.inheritedEventCount);
  assert.equal(result.eventState, 'shared-frozen');
  assert.deepEqual(result.events, session.snapshotEvents());
  assert.deepEqual(Object.keys(result).sort(), ['eventState', 'events', 'header', 'inheritedEventCount']);
}

for (const compression of ['none', 'zstd'] as const) {
  test(`official ${compression} sessions, seed, fork, opaque IDs and empty history round-trip without writes`, async (t) => {
    const f = await fixture(t, compression);
    const before = snapshot(f.allowedBase);
    assert.equal(f.parent.header.cwd, undefined);
    assert.equal(f.fork.inheritedEventCount, 2);
    assert.equal(f.seed.inheritedEventCount, 0);
    for (const session of f.sessions) {
      const log = await f.persistence.resolveCurrentLog(session.id);
      assert.ok(log);
      assert.equal(relative(f.sourceRoot, log).split(/[\\/]/).length, 3);
      await assertSession(session, f);
    }
    await assertSession(f.parent, { allowedBase: f.sourceRoot, sourceRoot: f.sourceRoot });
    await assert.rejects(readSession({ ...f, sessionId: 'absent' }), hasCode('SESSION_NOT_FOUND'));
    assert.deepEqual(snapshot(f.allowedBase), before);
  });

  test(`real ${compression} CLI returns exactly one envelope and leaves evidence unchanged`, async (t) => {
    const f = await fixture(t, compression);
    const before = snapshot(f.allowedBase);
    for (const session of [f.fork, f.opaque]) {
      const reply = await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload(session.id)));
      assert.equal(reply.code, 0);
      assert.equal(reply.diagnostics, '');
      assert.deepEqual(reply.envelope, {
        protocolVersion: 1, requestId, ok: true,
        result: {
          header: { ...session.header, delegationDepth: session.header.delegationDepth ?? 0 },
          inheritedEventCount: session.inheritedEventCount,
          eventState: 'shared-frozen', events: session.snapshotEvents(),
        },
      });
    }
    assert.deepEqual(snapshot(f.allowedBase), before);
  });
}

test('CLI entry detection works through a directory junction without weakening source checks', async (t) => {
  const f = await fixture(t);
  const bin = join(directory(t), 'bin');
  fs.symlinkSync(fileURLToPath(new URL('../../dist/', import.meta.url)), bin, 'junction');
  const reply = await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload(f.parent.id)), [], join(bin, 'session_reader.js'));
  assert.equal(reply.code, 0);
  assert.equal(reply.envelope.ok, true);
  assert.equal(reply.envelope.requestId, requestId);
});

test('missing sessions are structured failures and never materialize evidence', async (t) => {
  const f = await fixture(t);
  const before = snapshot(f.allowedBase);
  await assert.rejects(readSession({ ...f, sessionId: 'SECRET-missing' }), hasCode('SESSION_NOT_FOUND'));
  assertFailure(await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload('SECRET-missing'))), 'SESSION_NOT_FOUND');
  assert.deepEqual(snapshot(f.allowedBase), before);
  const empty = directory(t);
  const emptyBefore = snapshot(empty);
  await assert.rejects(readSession({ allowedBase: empty, sourceRoot: empty, sessionId: 'missing' }), hasCode('SESSION_NOT_FOUND'));
  assert.deepEqual(snapshot(empty), emptyBefore);
});

test('missing roots, non-directories, sibling prefixes and traversal are denied without creating paths', async (t) => {
  const base = directory(t);
  const allowedBase = join(base, 'allowed');
  const inside = join(allowedBase, 'source');
  const sibling = join(base, 'allowed-sibling');
  fs.mkdirSync(inside, { recursive: true });
  fs.mkdirSync(sibling);
  fs.writeFileSync(join(allowedBase, 'file'), 'SECRET');
  const before = snapshot(base);
  for (const [allowed, source] of [
    [allowedBase, sibling], [allowedBase, join(allowedBase, '..', 'allowed-sibling')],
    [allowedBase, join(allowedBase, 'missing')], [join(base, 'missing'), inside],
    [allowedBase, join(allowedBase, 'file')], [join(allowedBase, 'file'), inside],
  ] as const) {
    await assert.rejects(readSession({ allowedBase: allowed, sourceRoot: source, sessionId: 'id' }), hasCode('SOURCE_ROOT_DENIED'));
  }
  assertFailure(await cli(args(allowedBase, sibling), JSON.stringify(payload('id'))), 'SOURCE_ROOT_DENIED');
  assert.deepEqual(snapshot(base), before);
});

test('junctions at the base, source, intervening ancestors and anywhere in the tree are denied', async (t) => {
  const base = directory(t);
  const outside = directory(t);
  fs.mkdirSync(join(outside, 'source'));
  const real = join(base, 'real');
  fs.mkdirSync(real);
  const link = join(base, 'link');
  fs.symlinkSync(outside, link, 'junction');
  for (const options of [
    { allowedBase: base, sourceRoot: link },
    { allowedBase: base, sourceRoot: join(link, 'source') },
    { allowedBase: link, sourceRoot: join(link, 'source') },
    { allowedBase: base, sourceRoot: base },
  ]) {
    await assert.rejects(readSession({ ...options, sessionId: 'id' }), hasCode('SOURCE_ROOT_DENIED'));
  }
  fs.symlinkSync(real, join(real, 'cycle'), 'junction');
  await assert.rejects(readSession({ allowedBase: base, sourceRoot: real, sessionId: 'id' }), hasCode('SOURCE_ROOT_DENIED'));
  const f = await fixture(t);
  fs.mkdirSync(join(f.sourceRoot, 'unrelated', 'deep'), { recursive: true });
  fs.symlinkSync(outside, join(f.sourceRoot, 'unrelated', 'deep', 'escape'), 'junction');
  await assert.rejects(readSession({ ...f, sessionId: f.parent.id }), hasCode('SOURCE_ROOT_DENIED'));
  assertFailure(await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload(f.parent.id))), 'SOURCE_ROOT_DENIED');
  assert.deepEqual(fs.readdirSync(outside), ['source']);
});

test('file symlinks are denied even when their target remains inside the source', async (t) => {
  const base = directory(t);
  const target = join(base, 'target');
  fs.writeFileSync(target, 'SECRET');
  try {
    fs.symlinkSync(target, join(base, 'link'), 'file');
  } catch (error) {
    if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
      t.skip('Windows file symlinks require Developer Mode or elevated privileges');
      return;
    }
    throw error;
  }
  await assert.rejects(readSession({ allowedBase: base, sourceRoot: base, sessionId: 'id' }), hasCode('SOURCE_ROOT_DENIED'));
});

test('invalid helper inputs are rejected before filesystem access', async () => {
  for (const options of [
    null, {}, { allowedBase: '.', sourceRoot: '.', sessionId: 'id' },
    { allowedBase: resolve('.'), sourceRoot: resolve('.'), sessionId: '' },
    { allowedBase: resolve('.'), sourceRoot: resolve('.'), sessionId: 7 },
    { allowedBase: resolve('.'), sourceRoot: resolve('.'), sessionId: '\ud800' },
    { allowedBase: `${resolve('.')}\0`, sourceRoot: resolve('.'), sessionId: 'id' },
  ]) {
    await assert.rejects(readSession(options as Parameters<typeof readSession>[0]), hasCode('INVALID_REQUEST'));
  }
});

test('CLI strictly validates request shape, encoding and its stdin byte limit', async (t) => {
  const base = directory(t);
  const valid = payload('id');
  const invalid: [string | Buffer, string | null][] = [
    ['', null], ['{SECRET', null], ['null', null], ['[]', null], ['1', null],
    [JSON.stringify([valid]), null], [JSON.stringify(valid) + JSON.stringify(valid), null],
    [Buffer.from([0xff]), null], [JSON.stringify({ ...valid, protocolVersion: 2 }), requestId],
    [JSON.stringify({ ...valid, protocolVersion: true }), requestId],
    [JSON.stringify({ ...valid, operation: 'write' }), requestId],
    [JSON.stringify({ ...valid, sourceRoot: 'SECRET' }), requestId],
    [JSON.stringify({ ...valid, sessionId: '' }), requestId],
    [JSON.stringify({ ...valid, sessionId: 12 }), requestId],
    [JSON.stringify({ ...valid, sessionId: '\ud800' }), requestId],
    [JSON.stringify({ ...valid, sessionId: undefined }), requestId],
    [JSON.stringify({ ...valid, requestId: '' }), null],
    [JSON.stringify({ ...valid, requestId: 1 }), null],
    [JSON.stringify({ ...valid, requestId: undefined }), null],
    [JSON.stringify({ ...valid, requestId: 'a'.repeat(1025) }), null],
    [JSON.stringify({ ...valid, sessionId: 'a'.repeat(16 * 1024 + 1) }), requestId],
    [' '.repeat(MAX_REQUEST_BYTES + 1), null],
  ];
  for (const [input, id] of invalid) {
    assertFailure(await cli(args(base, base), input), 'INVALID_REQUEST', id);
  }
  const json = JSON.stringify(valid);
  assertFailure(await cli(args(base, base), json + ' '.repeat(MAX_REQUEST_BYTES - Buffer.byteLength(json))), 'SESSION_NOT_FOUND');
});

test('CLI accepts only the two required, unique absolute-path flags', async (t) => {
  const base = directory(t);
  const input = JSON.stringify(payload('id'));
  for (const argv of [
    [], ['--allowed-base', base], ['--allowed-base', base, '--source-root'],
    ['--allowed-base', base, '--allowed-base', base], ['--unknown', base, '--source-root', base],
    ['--allowed-base', base, '--source-root', '.'], ['--allowed-base', '', '--source-root', base],
    [...args(base, base), '--extra'], [`--allowed-base=${base}`, '--source-root', base],
  ]) {
    assertFailure(await cli(argv, input), 'INVALID_REQUEST');
  }
  assertFailure(await cli(['--source-root', base, '--allowed-base', base], input), 'SESSION_NOT_FOUND');
});

test('corrupt official artifacts fail at open without leaking contents or changing files', async (t) => {
  const f = await fixture(t);
  const log = await f.persistence.resolveCurrentLog(f.parent.id);
  assert.ok(log);
  fs.writeFileSync(log, 'SECRET-invalid-artifact\n');
  const before = snapshot(f.allowedBase);
  await assert.rejects(readSession({ ...f, sessionId: f.parent.id }), hasCode('DSH_OPEN_FAILED'));
  assertFailure(await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload(f.parent.id))), 'DSH_OPEN_FAILED');
  assert.deepEqual(snapshot(f.allowedBase), before);
});

test('official read handles are closed and their contexts disposed on success and read failure', async (t) => {
  const f = await fixture(t);
  const original = JsonlSessionPersistence.prototype.open;
  for (const failRead of [false, true]) {
    let captured: SessionHandle | undefined;
    let disposed = false;
    let closed = false;
    const spy = t.mock.method(JsonlSessionPersistence.prototype, 'open', async function (
      this: JsonlSessionPersistence, ...parameters: Parameters<typeof original>
    ) {
      assert.equal(parameters[1], 'read');
      const handle = await original.apply(this, parameters);
      captured = handle;
      this.ctx.effect(() => () => { disposed = true; });
      const close = handle.close.bind(handle);
      t.mock.method(handle, 'close', async () => { await close(); closed = true; });
      if (failRead) {
        const log = await f.persistence.resolveCurrentLog(f.parent.id);
        assert.ok(log);
        fs.unlinkSync(log);
      }
      return handle;
    });
    try {
      if (failRead) await assert.rejects(readSession({ ...f, sessionId: f.parent.id }), hasCode('DSH_READ_FAILED'));
      else await assertSession(f.parent, f);
      assert.ok(captured);
      assert.equal(closed, true);
      assert.equal(disposed, true);
      await assert.rejects(captured.read(), SessionHandleClosedError);
      assert.equal(spy.mock.callCount(), 1);
    } finally {
      spy.mock.restore();
    }
  }
});

test('links introduced after official open are rechecked and the real handle is closed', async (t) => {
  const f = await fixture(t);
  const outside = directory(t);
  const original = JsonlSessionPersistence.prototype.open;
  let captured: SessionHandle | undefined;
  const spy = t.mock.method(JsonlSessionPersistence.prototype, 'open', async function (
    this: JsonlSessionPersistence, ...parameters: Parameters<typeof original>
  ) {
    const handle = await original.apply(this, parameters);
    captured = handle;
    fs.symlinkSync(outside, join(f.sourceRoot, 'late-link'), 'junction');
    return handle;
  });
  try {
    await assert.rejects(readSession({ ...f, sessionId: f.parent.id }), hasCode('SOURCE_ROOT_DENIED'));
    assert.ok(captured);
    await assert.rejects(captured.read(), SessionHandleClosedError);
  } finally {
    spy.mock.restore();
  }
});

test('a close rejection is sanitized, still disposes the context and never returns partial success', async (t) => {
  const f = await fixture(t);
  const original = JsonlSessionPersistence.prototype.open;
  let disposed = false;
  const spy = t.mock.method(JsonlSessionPersistence.prototype, 'open', async function (
    this: JsonlSessionPersistence, ...parameters: Parameters<typeof original>
  ) {
    const handle = await original.apply(this, parameters);
    this.ctx.effect(() => () => { disposed = true; });
    const close = handle.close.bind(handle);
    t.mock.method(handle, 'close', async () => { await close(); throw new Error('SECRET-close'); });
    return handle;
  });
  try {
    await assert.rejects(readSession({ ...f, sessionId: f.parent.id }), hasCode('DSH_READ_FAILED'));
    assert.equal(disposed, true);
  } finally {
    spy.mock.restore();
  }
});

test('CLI serializes failures atomically, after reading real persistence and cleaning up', async (t) => {
  const f = await fixture(t);
  const stringifyFault = `const original = JSON.stringify; JSON.stringify = function(value, ...rest) {
    if (value?.ok === true) throw new Error('SECRET-serialization');
    return original.call(this, value, ...rest);
  };`;
  const before = snapshot(f.allowedBase);
  assertFailure(await cli(args(f.allowedBase, f.sourceRoot), JSON.stringify(payload(f.parent.id)), [
    '--import', `data:text/javascript,${encodeURIComponent(stringifyFault)}`,
  ]), 'SERIALIZATION_FAILED');
  assert.deepEqual(snapshot(f.allowedBase), before);
});
