import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { SessionId, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session';
import { SessionFormatUnsupportedError, validateStoredEvents } from '@deepseek-ai/dsh-session-persistence';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import {
  BUNDLE_DESCRIPTOR_FILENAME, BundleWriter, RunObservationState, buildBundleDescriptor,
  writeBundleDescriptor, type BundleDescriptor,
} from '../src/bundle_writer.js';
import type { EvalControlConfig } from '../src/config.js';
import { forkLineageOf, forkSessionMeta, validateForkLineage } from '../src/fork.js';
import { STOP_REASONS, deriveStopReason, isStopReason, type StopReason } from '../src/stop_reason.js';

function config(overrides: Partial<EvalControlConfig> = {}): EvalControlConfig {
  return {
    run: { run_id: 'run', job_config_hash: 'b'.repeat(64), config_file_sha256: 'c'.repeat(64), runtime_lock_digest: 'd'.repeat(64) },
    trialId: 'trial', sessionId: 'selected', sessionRoot: 'sessions/selected',
    configDigest: 'a'.repeat(64), provider: 'provider', model: 'model',
    gatewayUrl: 'http://localhost:9000', jobTokenFile: '/job-token',
    bundlePath: BUNDLE_DESCRIPTOR_FILENAME, refuseAuxiliaryCalls: true,
    ...overrides,
  };
}

function directory(t: TestContext): string {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'dsh-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function store(t: TestContext): Context {
  const ctx = new Context();
  new SessionStore(ctx);
  t.after(() => ctx.fiber.dispose());
  return ctx;
}

function completed(): RunObservationState {
  const state = new RunObservationState('selected');
  state.recordTurnStart(1);
  state.recordTurnEnd('completed', 1);
  return state;
}

const successes = ['agent_exit_0', 'agent_claimed_done'] as const;
const failures = STOP_REASONS.filter((reason) => reason !== 'agent_exit_0' && reason !== 'agent_claimed_done');

test('stop reasons are closed and default to infra_error without trusted terminal evidence', () => {
  assert.deepEqual(STOP_REASONS, [
    'agent_exit_0', 'agent_exit_nonzero', 'agent_claimed_done', 'budget_exhausted',
    'timeout_killed', 'crashed', 'infra_error',
  ]);
  assert.equal(Object.isFrozen(STOP_REASONS), true);
  for (const value of [undefined, null, 0, '', 'completed', 'success', 'agent_exit_0 ']) {
    assert.equal(isStopReason(value), false);
  }
  for (const sessionDisposed of [false, true]) {
    assert.equal(deriveStopReason({ sessionDisposed }), 'infra_error');
    assert.equal(deriveStopReason({
      sessionDisposed, currentTurn: 1, lastTurnEndTurn: 1,
      lastTurnEndKind: 'completed', turnInProgress: false,
    }), 'infra_error');
    assert.equal(deriveStopReason({ sessionDisposed, lastTurnEndKind: 'completed' }), 'infra_error');
  }
  assert.throws(() => deriveStopReason({
    sessionDisposed: false, terminalReason: 'completed' as StopReason,
  }), TypeError);
});

test('completed turn 1 cannot hide an active turn 2 or later failure', () => {
  const state = completed();
  assert.equal(state.hasCompletedTurn(), true);
  assert.equal(state.stopReason(), 'infra_error');
  state.recordTurnStart(2);
  state.recordTurnEnd('completed', 1);
  state.recordTurnEnd('completed');
  state.recordSessionDisposed();
  assert.equal(state.hasCompletedTurn(), false);
  assert.equal(state.stopReason(), 'infra_error');
  state.recordTerminal('timeout_killed');
  assert.equal(state.stopReason(), 'timeout_killed');
});

test('turn completion requires an observed active start and exact numbered end', () => {
  const state = new RunObservationState('selected');
  assert.equal(state.hasCompletedTurn(), false);
  state.recordTurnEnd('completed');
  state.recordTurnEnd('completed', 1);
  assert.equal(state.hasCompletedTurn(), false);
  state.recordTurnStart(1);
  state.recordTurnEnd('completed');
  state.recordTurnEnd('completed', 0);
  state.recordTurnEnd('completed', 2);
  assert.equal(state.hasCompletedTurn(), false);
  state.recordTurnEnd('error', 1);
  state.recordTurnEnd('completed', 1);
  assert.equal(state.hasCompletedTurn(), false);
  state.recordTurnStart(1);
  state.recordTurnStart(0);
  state.recordTurnEnd('completed', 1);
  assert.equal(state.hasCompletedTurn(), false);
  state.recordTurnStart(2);
  state.recordTurnStart(1);
  state.recordTurnEnd('completed', 2);
  assert.equal(state.hasCompletedTurn(), true);
  state.recordTurnEnd('error', 1);
  state.recordTurnEnd('error', 2);
  state.recordTurnStart(2);
  assert.equal(state.hasCompletedTurn(), true);
  assert.equal(state.stopReason(), 'infra_error');
});

test('turn and session identity validation is exact', () => {
  const state = new RunObservationState('selected');
  assert.equal(state.matchesSession('selected'), true);
  for (const id of ['selected-other', 'Selected', '', undefined, { id: 'selected' }]) {
    assert.equal(state.matchesSession(id), false);
  }
  for (const turn of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
    assert.throws(() => state.recordTurnStart(turn as number), RangeError);
    if (turn !== undefined) assert.throws(() => state.recordTurnEnd('completed', turn), RangeError);
  }
  state.recordTurnStart(0);
  state.recordTurnEnd('completed', 0);
  assert.equal(state.hasCompletedTurn(), true);
  assert.throws(() => state.recordTerminal('completed' as StopReason), TypeError);
});

for (const kind of ['aborted', 'blocked', 'error', 'max-tokens', 'interrupted', 'forked', 'unknown']) {
  test(`turn end ${kind} is not completion or terminal evidence`, () => {
    const state = new RunObservationState('selected');
    state.recordTurnStart(1);
    state.recordTurnEnd(kind, 1);
    state.recordSessionDisposed();
    assert.equal(state.hasCompletedTurn(), false);
    assert.equal(state.stopReason(), 'infra_error');
  });
}

for (const reason of STOP_REASONS) {
  test(`disposal never latches; trusted host finalization preserves exactly ${reason}`, () => {
    const state = completed();
    state.recordSessionDisposed();
    state.recordSessionDisposed();
    assert.equal(state.stopReason(), 'infra_error');
    state.recordTerminal(reason);
    state.recordSessionDisposed();
    assert.equal(state.stopReason(), reason);
    assert.equal(deriveStopReason({ sessionDisposed: false, terminalReason: reason }), reason);
  });
}

for (const success of successes) {
  test(`control loss before or after ${success} permanently prevents success`, () => {
    for (const lostFirst of [false, true]) {
      const state = completed();
      if (lostFirst) state.recordControlLost();
      state.recordTerminal(success);
      state.recordControlLost();
      state.recordTerminal(success);
      state.recordTurnStart(2);
      state.recordTurnEnd('completed', 2);
      state.recordSessionDisposed();
      assert.equal(state.stopReason(), 'infra_error');
      assert.equal(deriveStopReason({
        sessionDisposed: true, terminalReason: success, controlLost: true,
      }), 'infra_error');
    }
  });

  for (const failure of failures) {
    test(`${failure} dominates ${success} in either observation order`, () => {
      for (const failureFirst of [false, true]) {
        const state = completed();
        state.recordSessionDisposed();
        if (failureFirst) state.recordTerminal(failure);
        state.recordTerminal(success);
        state.recordTerminal(failure);
        state.recordTerminal(success);
        assert.equal(state.stopReason(), failure);
        state.recordTerminal('infra_error');
        state.recordTerminal(success);
        assert.equal(state.stopReason(), 'infra_error');
      }
    });
  }
}

test('first explicit failure sticks unless infrastructure failure supersedes it', () => {
  const state = completed();
  state.recordTerminal('timeout_killed');
  state.recordTerminal('crashed');
  state.recordTerminal('budget_exhausted');
  assert.equal(state.stopReason(), 'timeout_killed');
  state.recordTerminal('infra_error');
  state.recordTerminal('crashed');
  assert.equal(state.stopReason(), 'infra_error');
});

test('refusals dominate nominal success and identity loss outranks budget exhaustion', () => {
  for (const success of successes) {
    for (const refusalFirst of [false, true]) {
      const state = completed();
      if (refusalFirst) state.recordRefusal('budget_exhausted');
      state.recordTerminal(success);
      state.recordRefusal('budget_exhausted');
      assert.equal(state.stopReason(), 'budget_exhausted');
      state.recordTerminal('timeout_killed');
      assert.equal(state.stopReason(), 'timeout_killed');
      state.recordRefusal('identity_mismatch');
      state.recordRefusal('budget_exhausted');
      state.recordTerminal(success);
      assert.equal(state.stopReason(), 'infra_error');
    }
  }
  for (const kind of ['identity_mismatch', 'auxiliary_call'] as const) {
    const state = completed();
    state.recordRefusal(kind);
    state.recordTerminal('agent_exit_0');
    assert.equal(state.stopReason(), 'infra_error');
    assert.equal(deriveStopReason({ sessionDisposed: false, refusal: { kind } }), 'infra_error');
  }
});

test('bundle descriptors keep schema 2, run binding, allowlisted fields, and fork step zero', () => {
  const descriptor = buildBundleDescriptor(config({
    lineage: { parentSessionId: 'parent', parentTrialId: 'parent-trial', forkStep: 0 },
  }), 'infra_error');
  assert.deepEqual(descriptor, {
    schema_version: 2, run: config().run, trial_id: 'trial', session_id: 'selected', session_root: 'sessions/selected',
    stop_reason: 'infra_error', config_digest: 'a'.repeat(64),
    lineage: { parent_session_id: 'parent', parent_trial_id: 'parent-trial', fork_step: 0 },
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.run), true);
  assert.equal(Object.isFrozen(descriptor.lineage), true);
  assert.equal(Object.hasOwn(buildBundleDescriptor(config(), 'infra_error'), 'lineage'), false);
  assert.throws(() => buildBundleDescriptor(config(), 'done' as StopReason), TypeError);
});

test('descriptor build and write reject missing bindings and invalid identity before filesystem effects', (t) => {
  const root = directory(t);
  const target = join(root, 'uncreated', BUNDLE_DESCRIPTOR_FILENAME);
  const source = config();
  const descriptor = buildBundleDescriptor(source, 'infra_error');
  for (const [configKey, descriptorKey] of [['run', 'run'], ['trialId', 'trial_id'], ['sessionId', 'session_id'], ['configDigest', 'config_digest']]) {
    const missingConfig: Record<string, unknown> = { ...source };
    const missingDescriptor: Record<string, unknown> = { ...descriptor };
    delete missingConfig[configKey!];
    delete missingDescriptor[descriptorKey!];
    assert.throws(() => buildBundleDescriptor(missingConfig as unknown as EvalControlConfig, 'infra_error'));
    assert.throws(() => writeBundleDescriptor(target, missingDescriptor as unknown as BundleDescriptor));
  }
  const invalidRuns: unknown[] = [undefined, null, [], 'run', Object.create(source.run), { ...source.run, extra: true }, { ...source.run, run_id: 'bad id' }];
  for (const key of Object.keys(source.run)) {
    const missing: Record<string, unknown> = { ...source.run };
    delete missing[key];
    invalidRuns.push(missing);
    if (key !== 'run_id') {
      for (const value of ['a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`]) invalidRuns.push({ ...source.run, [key]: value });
    }
  }
  for (const run of invalidRuns) {
    assert.throws(() => buildBundleDescriptor({ ...source, run } as EvalControlConfig, 'infra_error'));
    assert.throws(() => writeBundleDescriptor(target, { ...descriptor, run } as BundleDescriptor));
  }
  for (const value of [undefined, null, '', 'bad id', 'bad\nvalue', 1]) {
    for (const [configKey, descriptorKey] of [['trialId', 'trial_id'], ['sessionId', 'session_id']]) {
      assert.throws(() => buildBundleDescriptor({ ...source, [configKey!]: value }, 'infra_error'));
      assert.throws(() => writeBundleDescriptor(target, { ...descriptor, [descriptorKey!]: value }));
    }
  }
  for (const value of [undefined, null, '', 'a'.repeat(63), 'A'.repeat(64), `${'a'.repeat(64)}\n`]) {
    assert.throws(() => buildBundleDescriptor({ ...source, configDigest: value } as EvalControlConfig, 'infra_error'));
    assert.throws(() => writeBundleDescriptor(target, { ...descriptor, config_digest: value } as BundleDescriptor));
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

test('descriptor run is detached and frozen while two trials preserve their own identity', (t) => {
  const root = directory(t);
  const source = config();
  const mutableRun = { ...source.run };
  const first = buildBundleDescriptor({ ...source, run: mutableRun }, 'infra_error');
  const second = buildBundleDescriptor(config({
    trialId: 'trial-b', sessionId: 'session-b', sessionRoot: 'sessions/session-b', configDigest: 'e'.repeat(64),
  }), 'infra_error');
  assert.equal(Object.isFrozen(mutableRun), false);
  assert.notEqual(first.run, mutableRun);
  mutableRun.run_id = 'changed';
  mutableRun.config_file_sha256 = 'f'.repeat(64);
  assert.throws(() => Object.assign(first.run, { run_id: 'changed' }), TypeError);
  assert.deepEqual(first.run, source.run);
  assert.deepEqual(first.run, second.run);
  for (const value of [first, second]) {
    const target = join(root, value.trial_id, BUNDLE_DESCRIPTOR_FILENAME);
    writeBundleDescriptor(target, value);
    const stored = JSON.parse(fs.readFileSync(target, 'utf8')) as BundleDescriptor;
    assert.deepEqual(stored, value);
    assert.equal(stored.schema_version, 2);
    assert.deepEqual(stored.run, source.run);
  }
  assert.notEqual(first.trial_id, second.trial_id);
  assert.notEqual(first.session_id, second.session_id);
  assert.notEqual(first.config_digest, second.config_digest);
});

for (const reason of STOP_REASONS) {
  test(`writes ${reason} atomically with only schema fields`, (t) => {
    const root = directory(t);
    fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
    const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
    const descriptor = buildBundleDescriptor(config(), reason);
    assert.equal(writeBundleDescriptor(target, { ...descriptor, secret: 'not serialized' } as BundleDescriptor), resolve(target));
    const payload = fs.readFileSync(target, 'utf8');
    assert.ok(payload.endsWith('\n'));
    assert.deepEqual(JSON.parse(payload), descriptor);
    assert.equal(payload.includes('not serialized'), false);
    assert.deepEqual(fs.readdirSync(root).sort(), [BUNDLE_DESCRIPTOR_FILENAME, 'sessions']);
    assert.equal(writeBundleDescriptor(target, descriptor), resolve(target));
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), descriptor);
  });
}

for (const reason of successes) {
  test(`${reason} requires an existing sessionRoot and preserves a prior failure descriptor`, (t) => {
    const root = directory(t);
    const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
    const state = new RunObservationState('selected');
    const writer = new BundleWriter(target, config());
    writer.flush(state);
    const original = fs.readFileSync(target, 'utf8');
    state.recordTerminal(reason);
    assert.throws(() => writer.flush(state), /existing sessionRoot directory/);
    assert.equal(writer.lastWrittenStopReason, 'infra_error');
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(root), [BUNDLE_DESCRIPTOR_FILENAME]);
    fs.mkdirSync(join(root, 'sessions'));
    assert.throws(() => writer.flush(state), /existing sessionRoot directory/);
    fs.mkdirSync(join(root, 'sessions', 'selected'));
    writer.flush(state);
    assert.equal(writer.lastWrittenStopReason, reason);
  });
}

for (const reason of failures) {
  test(`${reason} can report a missing evidence directory without creating it`, (t) => {
    const root = directory(t);
    const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
    writeBundleDescriptor(target, buildBundleDescriptor(config(), reason));
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).stop_reason, reason);
    assert.deepEqual(fs.readdirSync(root), [BUNDLE_DESCRIPTOR_FILENAME]);
  });
}

test('descriptor schema and sessionRoot protections apply to failures too', (t) => {
  const root = directory(t);
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const descriptor = buildBundleDescriptor(config(), 'infra_error');
  for (const schema_version of [undefined, 1, 3, '2']) {
    assert.throws(() => writeBundleDescriptor(target, { ...descriptor, schema_version } as unknown as BundleDescriptor), TypeError);
  }
  assert.throws(() => writeBundleDescriptor(target, { ...descriptor, stop_reason: 'done' } as unknown as BundleDescriptor), TypeError);
  for (const session_root of [
    '../escape', '..\\escape', '/absolute', 'C:\\absolute', 'C:relative', '\\\\server\\share',
    'session:stream', 'sessions/NUL.txt', 'sessions/CON', 'sessions/COM1', 'sessions/LPT¹.log',
    'sessions/trailing.', 'sessions/trailing ', 'sessions/ leading', 'sessions/a?b',
  ]) {
    assert.throws(() => writeBundleDescriptor(target, { ...descriptor, session_root }), /sessionRoot/, session_root);
  }
  fs.writeFileSync(join(root, 'sessions'), 'not a directory');
  assert.throws(() => writeBundleDescriptor(target, descriptor), /directory/);
  assert.equal(fs.existsSync(target), false);
});

test('safe Windows relative paths normalize without losing directory checks', (t) => {
  const root = directory(t);
  fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const descriptor = buildBundleDescriptor(config({ sessionRoot: '.\\sessions\\selected' }), 'agent_exit_0');
  writeBundleDescriptor(target, descriptor);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).session_root, 'sessions/selected');
  writeBundleDescriptor(target, buildBundleDescriptor(config({ sessionRoot: '.' }), 'agent_exit_0'));
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).session_root, '.');
});

test('symlink escapes, symlink descriptor ancestors, and non-file targets are rejected', (t) => {
  const root = directory(t);
  const outside = directory(t);
  fs.symlinkSync(outside, join(root, 'escape'), 'junction');
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  assert.throws(() => writeBundleDescriptor(target, buildBundleDescriptor(config({ sessionRoot: 'escape' }), 'infra_error')), /escapes/);
  assert.throws(() => writeBundleDescriptor(join(root, 'escape', BUNDLE_DESCRIPTOR_FILENAME), buildBundleDescriptor(config(), 'infra_error')), /symlink/);
  fs.mkdirSync(target);
  assert.throws(() => writeBundleDescriptor(target, buildBundleDescriptor(config(), 'infra_error')), /regular file/);
  assert.deepEqual(fs.readdirSync(outside), []);
});

for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync'] as const) {
  test(`${operation} failure propagates, cleans its temp file, and permits an infra_error downgrade`, (t) => {
    const root = directory(t);
    fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
    const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
    const state = completed();
    state.recordTerminal('agent_exit_0');
    const writer = new BundleWriter(target, config());
    assert.equal(writer.lastWrittenStopReason, undefined);
    writer.flush(state);
    const original = fs.readFileSync(target, 'utf8');
    const failure = new Error(`injected ${operation} failure`);
    const mock = t.mock.method(fs, operation, () => { throw failure; });
    syncBuiltinESMExports();
    try {
      assert.throws(() => writer.flush(state), (error) => error === failure);
      assert.equal(mock.mock.callCount(), 1);
      assert.equal(writer.lastWrittenStopReason, 'agent_exit_0');
      assert.equal(fs.readFileSync(target, 'utf8'), original);
      assert.deepEqual(fs.readdirSync(root).sort(), [BUNDLE_DESCRIPTOR_FILENAME, 'sessions']);
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
    state.recordTerminal('infra_error');
    writer.flush(state);
    assert.equal(writer.lastWrittenStopReason, 'infra_error');
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).stop_reason, 'infra_error');
  });
}

test('session evidence is rechecked before rename and temporary files are removed', (t) => {
  const root = directory(t);
  const evidence = join(root, 'sessions', 'selected');
  fs.mkdirSync(evidence, { recursive: true });
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const originalFsync = fs.fsyncSync;
  const mock = t.mock.method(fs, 'fsyncSync', (fd: number) => {
    originalFsync(fd);
    fs.rmSync(evidence, { recursive: true });
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => writeBundleDescriptor(target, buildBundleDescriptor(config(), 'agent_claimed_done')), /existing sessionRoot directory/);
    assert.deepEqual(fs.readdirSync(root), ['sessions']);
  } finally {
    mock.mock.restore();
    syncBuiltinESMExports();
  }
});

test('fork validation checks exact owner-selected identity and actual immutable parent metadata', (t) => {
  const ctx = store(t);
  const value = config({ lineage: { parentSessionId: 'parent', parentTrialId: 'parent-trial', forkStep: 0 } });
  const parent = ctx.sessions.create(SessionId('parent'));
  const child = ctx.sessions.fork(parent, undefined, SessionId('selected'));
  const count = child.seq;
  const sessions = ctx.sessions.list();
  const observed: SessionEvent[] = [];
  ctx.on('session/event', (_session, event) => { observed.push(event); });
  validateForkLineage(child, value);
  validateForkLineage(child, value);
  assert.equal(child.header.parentSession, 'parent');
  assert.equal(Object.isFrozen(child.header), true);
  assert.equal(child.seq, count);
  assert.deepEqual(ctx.sessions.list(), sessions);
  assert.deepEqual(observed, []);
  assert.deepEqual(forkSessionMeta(value), { parentSession: 'parent' });
  assert.deepEqual(forkLineageOf(value), { parent_session_id: 'parent', parent_trial_id: 'parent-trial', fork_step: 0 });
  assert.throws(() => validateForkLineage(parent, value), /session id/);
  const similar = ctx.sessions.create(SessionId('selected-other'), { meta: forkSessionMeta(value)! });
  assert.throws(() => validateForkLineage(similar, value), /session id/);
  assert.throws(() => validateForkLineage(child, config()), /parentSession/);
  assert.throws(() => validateForkLineage(child, config({ lineage: { parentSessionId: 'wrong' } })), /parentSession/);
  const unparented = ctx.sessions.create(SessionId('unparented'));
  assert.throws(() => validateForkLineage(unparented, { ...value, sessionId: 'unparented' }), /parentSession/);
  validateForkLineage(unparented, config({ sessionId: 'unparented' }));
  const metaChild = ctx.sessions.create(SessionId('meta-child'), { meta: forkSessionMeta(value)! });
  validateForkLineage(metaChild, { ...value, sessionId: 'meta-child' });
  assert.equal(metaChild.seq, 0);
  assert.equal(forkSessionMeta(config()), undefined);
  assert.equal(forkLineageOf(config()), undefined);
  assert.deepEqual(forkLineageOf(config({ lineage: { forkStep: 0 } })), { fork_step: 0 });
});

test('owner fork passes official persistence validation and awaited JSONL round-trip without custom events', async (t) => {
  const root = directory(t);
  const ctx = store(t);
  const persistence = new JsonlSessionPersistence(ctx, { root: join(root, 'sessions'), compression: 'none' });
  const parent = ctx.sessions.create(SessionId('parent'));
  parent.append('turn/start', { turn: 1 });
  parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  const child = ctx.sessions.fork(parent, undefined, SessionId('selected'));
  const value = config({ lineage: { parentSessionId: 'parent', forkStep: 0 } });
  validateForkLineage(child, value);
  const events = child.snapshotEvents();
  assert.deepEqual(events.map((event) => event.type), ['turn/start', 'turn/end', 'session/end-seed']);
  assert.deepEqual(validateStoredEvents(child.header, structuredClone([...events])), events);
  const unsupported = [{ type: 'aeval/lineage', seq: 0, time: Date.now(), data: {} }] as unknown as SessionEvent[];
  assert.throws(() => validateStoredEvents(child.header, unsupported), SessionFormatUnsupportedError);
  const handle = await persistence.create(child.header, { inheritedEventCount: child.inheritedEventCount });
  try {
    await handle.append(events);
    const state = completed();
    state.recordSessionDisposed();
    assert.equal(state.stopReason(), 'infra_error');
    await handle.flush();
    await handle.close();
    state.recordTerminal('agent_claimed_done');
    assert.equal(state.stopReason(), 'agent_claimed_done');
    const reader = await persistence.open(child.id, 'read');
    try {
      assert.equal(reader.header.parentSession, 'parent');
      assert.equal(reader.inheritedEventCount, child.inheritedEventCount);
      assert.deepEqual((await reader.read()).events, events);
    } finally {
      await reader.close();
    }
    const log = await persistence.resolveCurrentLog(child.id);
    assert.ok(log);
    const descriptor = buildBundleDescriptor({ ...value, sessionRoot: relative(root, dirname(log)) }, state.stopReason());
    writeBundleDescriptor(join(root, BUNDLE_DESCRIPTOR_FILENAME), descriptor);
    assert.equal(descriptor.lineage?.fork_step, 0);
  } finally {
    await handle.close();
  }
});

test('an awaited host persistence rejection overrides prior completed-turn observations', async (t) => {
  const ctx = store(t);
  const session = ctx.sessions.create(SessionId('selected'));
  const state = completed();
  const failure = new Error('persistence failed');
  ctx.on('session/flush', async () => { throw failure; });
  await assert.rejects(ctx.sessions.flush(session), (error) => error === failure);
  state.recordSessionDisposed();
  state.recordTerminal('infra_error');
  state.recordTerminal('agent_claimed_done');
  assert.equal(state.stopReason(), 'infra_error');
});

test('observation control claims are exclusive, revocable, and generation-specific', () => {
  const state = new RunObservationState('selected');
  const first = state.claimControl();
  assert.equal(state.ownsControl(first), true);
  assert.throws(() => state.claimControl(), /active control owner/);
  state.releaseControl(Symbol('unrelated'));
  assert.equal(state.ownsControl(first), true);
  state.releaseControl(first);
  assert.equal(state.ownsControl(first), false);
  const second = state.claimControl();
  assert.notEqual(second, first);
  state.releaseControl(first);
  assert.equal(state.ownsControl(second), true);
  state.releaseControl(second);
});

test('finalization failure survives ownership changes and cannot be upgraded to success', () => {
  const state = completed();
  const owner = state.claimControl();
  assert.equal(state.hasFailedFinalization(), false);
  state.recordFinalizationFailure();
  state.releaseControl(owner);
  const successor = state.claimControl();
  state.recordTerminal('agent_claimed_done');
  state.recordTerminal('agent_exit_0');
  state.recordTurnStart(2);
  state.recordTurnEnd('completed', 2);
  assert.equal(state.hasFailedFinalization(), true);
  assert.equal(state.stopReason(), 'infra_error');
  state.releaseControl(successor);
});

test('writer checks observation session identity before creating or replacing a descriptor', (t) => {
  const target = join(directory(t), BUNDLE_DESCRIPTOR_FILENAME);
  const writer = new BundleWriter(target, config());
  t.after(() => writer.release());
  const foreign = new RunObservationState('other-session');
  foreign.recordTerminal('timeout_killed');
  assert.throws(() => writer.flush(foreign), /Observation session/);
  assert.equal(fs.existsSync(target), false);
  assert.equal(writer.lastWrittenStopReason, undefined);
  writer.flush(new RunObservationState('selected'));
  const original = fs.readFileSync(target, 'utf8');
  assert.throws(() => writer.flush(foreign), /Observation session/);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
});

test('writer path ownership is exclusive until release and stale release cannot evict a successor', (t) => {
  const root = directory(t);
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const value = config();
  const state = new RunObservationState(value.sessionId);
  state.recordTerminal('timeout_killed');
  const first = new BundleWriter(target, value);
  t.after(() => first.release());
  first.flush(state);
  assert.throws(() => new BundleWriter(target, value), /active writer owner/);
  assert.throws(() => new BundleWriter(join(root, 'unused', '..', BUNDLE_DESCRIPTOR_FILENAME), value), /active writer owner/);
  if (process.platform === 'win32') {
    assert.throws(() => new BundleWriter(target.toUpperCase(), value), /active writer owner/);
  }
  first.release();
  assert.throws(() => first.flush(state), /released/);
  const successor = new BundleWriter(target, value);
  t.after(() => successor.release());
  first.release();
  assert.throws(() => new BundleWriter(target, value), /active writer owner/);
  state.recordTerminal('timeout_killed');
  successor.flush(state);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).stop_reason, 'timeout_killed');
});

for (const binding of ['trial', 'session', 'config', 'run', 'job-config', 'config-file', 'runtime-lock'] as const) {
  test(`a different ${binding} binding cannot overwrite an active or released writer's path`, (t) => {
    const target = join(directory(t), BUNDLE_DESCRIPTOR_FILENAME);
    const value = config();
    const foreign = config({
      ...(binding === 'trial' ? { trialId: 'other-trial' } : {}),
      ...(binding === 'session' ? { sessionId: 'other-session' } : {}),
      ...(binding === 'config' ? { configDigest: 'b'.repeat(64) } : {}),
      run: {
        ...value.run,
        ...(binding === 'run' ? { run_id: 'other-run' } : {}),
        ...(binding === 'job-config' ? { job_config_hash: 'e'.repeat(64) } : {}),
        ...(binding === 'config-file' ? { config_file_sha256: 'e'.repeat(64) } : {}),
        ...(binding === 'runtime-lock' ? { runtime_lock_digest: 'e'.repeat(64) } : {}),
      },
    });
    const first = new BundleWriter(target, value);
    t.after(() => first.release());
    first.flush(new RunObservationState(value.sessionId));
    const original = fs.readFileSync(target, 'utf8');
    assert.throws(() => new BundleWriter(target, foreign), /active writer owner/);
    first.release();
    const second = new BundleWriter(target, foreign);
    t.after(() => second.release());
    assert.throws(() => second.flush(new RunObservationState(foreign.sessionId)), /bound to a different/);
    assert.equal(second.lastWrittenStopReason, undefined);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    second.release();
    const third = new BundleWriter(target, value);
    t.after(() => third.release());
    third.flush(new RunObservationState(value.sessionId));
    assert.equal(fs.readFileSync(target, 'utf8'), original);
  });
}

test('different trials can own independent descriptor paths without sharing outcomes', (t) => {
  const root = directory(t);
  const firstPath = join(root, 'first', BUNDLE_DESCRIPTOR_FILENAME);
  const secondPath = join(root, 'second', BUNDLE_DESCRIPTOR_FILENAME);
  const first = new BundleWriter(firstPath, config());
  const second = new BundleWriter(secondPath, config({ trialId: 'other-trial', sessionId: 'other-session' }));
  t.after(() => { first.release(); second.release(); });
  const firstState = new RunObservationState('selected');
  const secondState = new RunObservationState('other-session');
  firstState.recordTerminal('timeout_killed');
  secondState.recordTerminal('crashed');
  first.flush(firstState);
  second.flush(secondState);
  assert.throws(() => first.flush(secondState), /Observation session/);
  assert.throws(() => second.flush(firstState), /Observation session/);
  assert.equal(JSON.parse(fs.readFileSync(firstPath, 'utf8')).stop_reason, 'timeout_killed');
  assert.equal(JSON.parse(fs.readFileSync(secondPath, 'utf8')).stop_reason, 'crashed');
});

test('writer snapshots its binding and rechecks the existing descriptor on every flush', (t) => {
  const root = directory(t);
  const target = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const value = { ...config() };
  const writer = new BundleWriter(target, value);
  t.after(() => writer.release());
  value.trialId = 'mutated-trial';
  const state = new RunObservationState('selected');
  writer.flush(state);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).trial_id, 'trial');
  writeBundleDescriptor(target, buildBundleDescriptor(config({ trialId: 'external-trial' }), 'crashed'));
  const original = fs.readFileSync(target, 'utf8');
  assert.throws(() => writer.flush(state), /bound to a different/);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
});

for (const failure of failures) {
  for (const success of successes) {
    test(`replacement writer cannot promote ${failure} to ${success}`, (t) => {
      const root = directory(t);
      fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
      const path = join(root, BUNDLE_DESCRIPTOR_FILENAME);
      const first = new BundleWriter(path, config());
      const failed = new RunObservationState('selected');
      failed.recordTerminal(failure);
      first.flush(failed);
      first.release();
      const original = fs.readFileSync(path, 'utf8');
      const second = new BundleWriter(path, config());
      t.after(() => second.release());
      const late = completed();
      late.recordTerminal(success);
      assert.throws(() => second.flush(late), /prior terminal/);
      assert.equal(fs.readFileSync(path, 'utf8'), original);
    });
  }
}

test('placeholder cannot be claimed by another observation or replacement writer', (t) => {
  const root = directory(t);
  fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
  const path = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  const first = new BundleWriter(path, config());
  first.flush(new RunObservationState('selected'));
  const late = completed();
  late.recordTerminal('agent_exit_0');
  assert.throws(() => first.flush(late), /observation cannot be replaced/);
  first.release();
  const second = new BundleWriter(path, config());
  t.after(() => second.release());
  assert.throws(() => second.flush(late), /prior terminal/);
  assert.equal(JSON.parse(fs.readFileSync(path, 'utf8')).stop_reason, 'infra_error');
});

test('a new observation cannot launder an existing failure through an identical placeholder', (t) => {
  const root = directory(t);
  fs.mkdirSync(join(root, 'sessions', 'selected'), { recursive: true });
  const path = join(root, BUNDLE_DESCRIPTOR_FILENAME);
  writeBundleDescriptor(path, buildBundleDescriptor(config(), 'infra_error'));
  const writer = new BundleWriter(path, config());
  t.after(() => writer.release());
  const state = new RunObservationState('selected');
  writer.flush(state);
  state.recordTerminal('agent_exit_0');
  assert.throws(() => writer.flush(state), /prior terminal/);
  assert.equal(JSON.parse(fs.readFileSync(path, 'utf8')).stop_reason, 'infra_error');
});
