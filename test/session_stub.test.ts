import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import { readSession } from '../src/session_reader.js';
import { assertUsableSessionId, mintTrialSession, SessionStubError } from '../src/session_stub.js';

const stubCliPath = fileURLToPath(new URL('../../dist/session_stub.js', import.meta.url));
const readerCliPath = fileURLToPath(new URL('../../dist/session_reader.js', import.meta.url));
const trialCwd = resolve(tmpdir(), 'aeval-trial-workspace');

function directory(t: TestContext): string {
  const path = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'dsh-stub-'));
  t.after(() => fs.rmSync(path, { recursive: true, force: true }));
  return path;
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof SessionStubError && error.code === code
    && !error.message.includes('SECRET');
}

async function mint(root: string, sessionId: string, cwd = trialCwd) {
  return mintTrialSession({ root, sessionId, cwd });
}

test('the minted stub is a durable session the official reader returns', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });

  const minted = await mint(root, 'session-aeval-trial-0001');

  assert.deepEqual(minted, { sessionId: 'session-aeval-trial-0001', headerVersion: 4, events: 0 });
  const read = await readSession({
    allowedBase: fs.realpathSync(root), sourceRoot: root, sessionId: 'session-aeval-trial-0001',
  });
  assert.equal(read.header.id, 'session-aeval-trial-0001');
  // The runner compares this exact string against its own mounted cwd and the
  // backend stores it verbatim, so the stub must not normalise what it was told.
  assert.equal(read.header.cwd, trialCwd);
  assert.deepEqual(read.events, []);
});

test('a stub is written by the official backend in the layout the reader walks', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });
  await mint(root, 'session-aeval-trial-0002');

  // POSIX write handles leave the official backend's empty `session.lock`
  // flock(2) lease artifact beside the log; Windows leases through a named
  // kernel semaphore and leaves no file. Only that documented artifact may
  // accompany the single session record the reader walks — anything else
  // (a stray file, a second record) still fails the layout assertion.
  const files = walk(root);
  const lease = files.filter((path) => path.endsWith('session.lock'));
  const records = files.filter((path) => !path.endsWith('session.lock'));
  assert.equal(records.length, 1);
  assert.ok(records[0]!.endsWith(join('session-aeval-trial-0002', 'session.v4.jsonl.zstd')), records[0]!);
  for (const path of lease) {
    assert.equal(basename(path), 'session.lock', path);
    assert.equal(fs.statSync(path).size, 0, path);
  }
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

test('an occupied identity is never overwritten', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });
  await mint(root, 'session-aeval-trial-0003');
  const before = fs.readdirSync(root, { recursive: true }).map(String);

  await assert.rejects(mint(root, 'session-aeval-trial-0003'), hasCode('SESSION_EXISTS'));
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).map(String), before);
});

test('a session the trial already started is opened, not stubbed again', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });
  const context = new Context();
  new SessionStore(context);
  t.after(() => context.fiber.dispose());
  const persistence = new JsonlSessionPersistence(context, { root, compression: 'none' });
  const live = context.sessions.create(SessionId('session-aeval-trial-0004'), { meta: { cwd: trialCwd } });
  live.append('turn/start', { turn: 1 });
  const handle = await persistence.create(live.header, { inheritedEventCount: live.inheritedEventCount });
  await handle.append(live.snapshotEvents());
  await handle.flush();
  await handle.close();

  await assert.rejects(mint(root, 'session-aeval-trial-0004'), hasCode('SESSION_EXISTS'));
});

test('an unusable identity or root fails before anything is written', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });
  for (const candidate of ['', ' two words', '../elsewhere', "quote'd", 'a;rm -rf /', 'a'.repeat(129), 'ünicode']) {
    assert.throws(() => assertUsableSessionId(candidate), hasCode('SESSION_ID_UNUSABLE'), candidate);
    await assert.rejects(mint(root, candidate), hasCode('SESSION_ID_UNUSABLE'), candidate);
  }
  assert.equal(fs.readdirSync(root).length, 0);
  await assert.rejects(mint(join(root, 'absent'), 'session-aeval-trial-0005'), hasCode('ROOT_DENIED'));
  await assert.rejects(mint('relative/sessions', 'session-aeval-trial-0006'), hasCode('ROOT_DENIED'));
  const file = join(root, 'plain-file');
  fs.writeFileSync(file, 'SECRET not a directory');
  await assert.rejects(mint(file, 'session-aeval-trial-0007'), hasCode('ROOT_DENIED'));
  await assert.rejects(mintTrialSession({ root, sessionId: 'session-aeval-trial-0008', cwd: 'work/dir' }),
    hasCode('CWD_UNUSABLE'));
});

test('the stub cli mints what the reader cli reads back', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });

  const minted = await cli(stubCliPath, ['--root', root], {
    protocolVersion: 1, requestId: 'stub-1', operation: 'mint',
    sessionId: 'session-aeval-trial-0009', cwd: trialCwd,
  });
  assert.equal(minted.ok, true);
  assert.equal(minted.result?.sessionId, 'session-aeval-trial-0009');

  const read = await cli(readerCliPath, ['--allowed-base', root, '--source-root', root], {
    protocolVersion: 1, requestId: 'reader-1', operation: 'read',
    sessionId: 'session-aeval-trial-0009',
  });
  assert.equal(read.ok, true);
  assert.equal(read.result?.header?.id, 'session-aeval-trial-0009');
});

test('the stub cli answers with a code instead of a stack', async (t) => {
  const root = join(directory(t), 'sessions');
  fs.mkdirSync(root, { recursive: true });

  const refused = await cli(stubCliPath, ['--root', root], {
    protocolVersion: 1, requestId: 'stub-2', operation: 'mint', sessionId: '../escape', cwd: trialCwd,
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.requestId, 'stub-2');
  assert.equal(refused.error?.code, 'SESSION_ID_UNUSABLE');

  const unargued = await cli(stubCliPath, [], {
    protocolVersion: 1, requestId: 'stub-3', operation: 'mint',
    sessionId: 'session-aeval-trial-0010', cwd: trialCwd,
  });
  assert.equal(unargued.ok, false);
  assert.equal(unargued.error?.code, 'INVALID_REQUEST');
  assert.ok(!JSON.stringify(unargued).includes('SECRET'));
});

interface CliReply {
  ok: boolean;
  requestId?: string | null;
  result?: { sessionId?: string; header?: { id?: string; cwd?: string } };
  error?: { code: string; message: string };
}

async function cli(entry: string, argv: string[], input: unknown): Promise<CliReply> {
  const child = spawn(process.execPath, [entry, ...argv], {
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 20_000, windowsHide: true,
  });
  const chunks: Buffer[] = [];
  const diagnostics: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { diagnostics.push(chunk); });
  const closed = new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject);
    child.stdin.on('error', (error: NodeJS.ErrnoException) => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => {
      if (signal !== null) reject(new Error(`Stub cli terminated by ${signal}`));
      else resolveExit(code);
    });
  });
  child.stdin.end(`${JSON.stringify(input)}\n`);
  const code = await closed;
  const text = Buffer.concat(chunks).toString('utf8');
  assert.equal(Buffer.concat(diagnostics).toString('utf8'), '', `stderr: ${Buffer.concat(diagnostics).toString('utf8')}`);
  const reply = JSON.parse(text.trim()) as CliReply;
  assert.equal(reply.ok, code === 0);
  return reply;
}
