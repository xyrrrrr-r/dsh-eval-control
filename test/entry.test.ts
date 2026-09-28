import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import plugin, { buildBundleDescriptor, installBrokerTransport, startHostBroker, writeBundleDescriptor, type EvalControlConfig } from '../src/index.js';

class Upstream extends LlmAdapter {
  calls = 0;
  override async resolveModel(provider: string, id: string) { return { provider, id, name: id }; }
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++;
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function fixture(t: TestContext, overrides: Partial<EvalControlConfig> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aeval-entry-'));
  mkdirSync(join(root, 'session'));
  const ctx = new Context();
  new LlmRuntime(ctx);
  new SystemPrompt(ctx, { includeHarnessIdentity: false });
  new ToolRuntime(ctx, { mode: 'native' });
  new SessionStore(ctx);
  const upstream = new Upstream();
  const broker = await startHostBroker({
    trialId: 'trial', sessionId: 'selected', configDigest: 'a'.repeat(64),
    run: { run_id: 'run', job_config_hash: 'b'.repeat(64), config_file_sha256: 'c'.repeat(64), runtime_lock_digest: 'd'.repeat(64) },
    identity: { provider: 'fixture', model: 'model' }, limits: {},
    maxOutputTokens: 8, upstream, signal: new AbortController().signal,
  });
  t.after(async () => {
    await ctx.fiber.dispose();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  });
  const config: EvalControlConfig = {
    trialId: 'trial', sessionId: 'selected', configDigest: 'a'.repeat(64),
    run: { run_id: 'run', job_config_hash: 'b'.repeat(64), config_file_sha256: 'c'.repeat(64), runtime_lock_digest: 'd'.repeat(64) },
    provider: 'fixture', model: 'model', sessionRoot: 'session',
    bundlePath: join(root, 'bundle_descriptor.json'), gatewayUrl: broker.url,
    jobTokenFile: join(root, 'job-token'), refuseAuxiliaryCalls: true, ...overrides,
  };
  await installBrokerTransport(ctx, config, broker.token);
  const session = ctx.sessions.prepare(SessionId('selected'));
  const detach = ctx.sessions.enter(session);
  ctx.sessions.announce(session);
  const controlPlugin = await ctx.plugin(plugin, config).await();
  const control = ctx.evalControl;
  const descriptor = () => JSON.parse(readFileSync(config.bundlePath, 'utf8')) as { stop_reason: string };
  const completeTurn = (turn = 1) => {
    session.append('turn/start', { turn });
    session.append('turn/end', { turn, reason: { kind: 'completed' } });
  };
  return { ctx, broker, upstream, config, session, detach, controlPlugin, control, descriptor, completeTurn };
}

test('entry injects independent broker dependency and unload leaves model route and lease alive', async (t) => {
  const f = await fixture(t);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
  await f.controlPlugin.dispose();
  assert.equal(f.descriptor().stop_reason, 'infra_error');
  assert.equal(f.broker.lease.snapshot().stopReason, undefined);
  const chunks: StreamChunk[] = [];
  for await (const chunk of f.ctx.llm.stream({
    provider: 'fixture', model: 'model', sessionId: SessionId('selected'), messages: [],
  })) chunks.push(chunk);
  assert.equal(chunks.at(-1)?.type, 'finish');
  assert.equal(f.upstream.calls, 1);
  await assert.rejects(f.control.finalize('agent_exit_0', async () => {}), /inactive/);
});

test('disposal alone never publishes completed evidence', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  f.detach();
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('owner awaits durability before publishing claimed completion and later unload preserves it', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  let persisted = false;
  f.ctx.on('session/flush', async () => { persisted = true; });
  await f.control.finalize('agent_claimed_done', async () => {
    assert.equal(f.descriptor().stop_reason, 'infra_error');
    assert.equal(await f.ctx.sessions.flush(f.session), true);
    f.detach();
  });
  assert.equal(persisted, true);
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
  await f.controlPlugin.dispose();
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
});

test('failed durability rejects finalization and leaves infra_error', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  f.ctx.on('session/flush', async () => { throw new Error('persistence failed'); });
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {
    await f.ctx.sessions.flush(f.session);
  }), /persistence failed/);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('completed old turn cannot certify an active later turn', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  f.session.append('turn/start', { turn: 2 });
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {}), /not completed/);
  f.detach();
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('events arriving during persistence invalidate completion', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {
    f.session.append('turn/start', { turn: 2 });
  }), /changed during finalization/);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('unloading while persistence awaits cannot resurrect completion', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {
    await f.controlPlugin.dispose();
  }), /changed during finalization/);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('same-ID session replacement cannot inherit completed-turn evidence', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  f.detach();
  assert.throws(() => f.ctx.sessions.create(SessionId('selected')), /cannot be replaced/);
  await f.control.finalize('agent_claimed_done', async () => {});
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('control reload cannot erase the trial loss of enforcement', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  await f.controlPlugin.dispose();
  await f.ctx.plugin(plugin, f.config).await();
  await f.ctx.evalControl.finalize('agent_claimed_done', async () => {});
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('unloaded finalizer never overwrites a successor-owned descriptor', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  let release!: () => void;
  const persistence = new Promise<void>((resolve) => { release = resolve; });
  const oldFinalization = f.control.finalize('agent_claimed_done', () => persistence);
  const rejected = assert.rejects(oldFinalization, /changed during finalization/);
  await f.controlPlugin.dispose();
  await f.ctx.plugin(plugin, f.config).await();
  writeBundleDescriptor(f.config.bundlePath, buildBundleDescriptor(f.config, 'timeout_killed'));
  release();
  await rejected;
  assert.equal(f.descriptor().stop_reason, 'timeout_killed');
});

test('trusted host timeout overrides a completed turn', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  await f.control.finalize('timeout_killed', async () => {});
  assert.equal(f.descriptor().stop_reason, 'timeout_killed');
});

test('broker timeout between turns cannot become nominal completion', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  f.broker.lease.stop('timeout_killed');
  await f.control.finalize('agent_claimed_done', async () => {});
  assert.equal(f.descriptor().stop_reason, 'timeout_killed');
});

test('missing completion evidence rejects the descriptor write', async (t) => {
  const f = await fixture(t, { sessionRoot: 'missing' });
  f.completeTurn();
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {}));
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('control installation fails when claimed parent metadata is absent', async (t) => {
  await assert.rejects(fixture(t, { lineage: { parentSessionId: 'parent' } }), /parentSession/);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const phase of ['persist', 'info'] as const) {
  for (const cancellation of ['caller', 'dispose'] as const) {
    for (const settlement of ['resolve', 'reject'] as const) {
      test(`${cancellation} promptly rejects pending ${phase}; late ${settlement} has no control effects`, { timeout: 5000 }, async (t) => {
        const f = await fixture(t);
        f.completeTurn();
        const adapter = f.ctx.evalBroker.adapter;
        const info = await adapter.info();
        const persistence = deferred<void>();
        const lookup = deferred<typeof info>();
        const infoStarted = deferred<void>();
        let persistSignal: AbortSignal | undefined;
        let infoSignal: AbortSignal | undefined;
        const infoMock = t.mock.method(adapter, 'info', (signal?: AbortSignal) => {
          infoSignal = signal;
          infoStarted.resolve();
          return phase === 'info' ? lookup.promise : Promise.resolve(info);
        });
        const persist = t.mock.fn((signal: AbortSignal) => {
          persistSignal = signal;
          return phase === 'persist' ? persistence.promise : Promise.resolve();
        });
        const { BundleWriter } = await import('../src/bundle_writer.js');
        const writes = t.mock.method(BundleWriter.prototype, 'flush');
        const cancel = new AbortController();
        const result = f.control.finalize('agent_claimed_done', persist, cancel.signal);
        const rejection = assert.rejects(result, /caller canceled|changed during finalization/);
        if (phase === 'info') await infoStarted.promise;
        if (cancellation === 'caller') cancel.abort(new Error('caller canceled'));
        else await f.controlPlugin.dispose();
        // Await rejection BEFORE settling the uncooperative operation: shutdown cannot depend on it.
        await rejection;
        assert.equal(f.descriptor().stop_reason, 'infra_error');
        assert.equal(persistSignal?.aborted, true);
        assert.equal(persist.mock.callCount(), 1);
        assert.equal(infoMock.mock.callCount(), phase === 'info' ? 1 : 0);
        if (phase === 'info') {
          assert.equal(infoSignal?.aborted, true);
          assert.equal(infoSignal?.reason, persistSignal?.reason);
        }
        if (cancellation === 'dispose') {
          await f.ctx.plugin(plugin, f.config).await();
          writeBundleDescriptor(f.config.bundlePath, buildBundleDescriptor(f.config, 'timeout_killed'));
        } else {
          await assert.rejects(f.control.finalize('agent_exit_0', persist), /previously failed/);
        }
        const snapshot = readFileSync(f.config.bundlePath, 'utf8');
        const writeCount = writes.mock.callCount();
        if (phase === 'persist') {
          if (settlement === 'resolve') persistence.resolve();
          else persistence.reject(new Error('late persistence rejection'));
        } else {
          if (settlement === 'resolve') lookup.resolve(info);
          else lookup.reject(new Error('late info rejection'));
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(writes.mock.callCount(), writeCount);
        assert.equal(infoMock.mock.callCount(), phase === 'info' ? 1 : 0);
        assert.equal(persist.mock.callCount(), 1);
        assert.equal(readFileSync(f.config.bundlePath, 'utf8'), snapshot);
      });
    }
  }
}

test('info retains its request deadline even when persistence uses lifecycle cancellation', { timeout: 5000 }, async (t) => {
  const f = await fixture(t);
  const deadline = new AbortController();
  const started = deferred<void>();
  const lookup = deferred<Awaited<ReturnType<typeof f.ctx.evalBroker.adapter.info>>>();
  const timeout = t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  let infoSignal: AbortSignal | undefined;
  const info = t.mock.method(f.ctx.evalBroker.adapter, 'info', (signal?: AbortSignal) => {
    infoSignal = signal;
    started.resolve();
    return lookup.promise;
  });
  const failure = new Error('info deadline exceeded');
  const finalization = f.control.finalize('agent_exit_0', async () => {});
  const rejected = assert.rejects(finalization, (error) => error === failure);
  await started.promise;
  assert.deepEqual(timeout.mock.calls.map((call) => call.arguments), [[30_000]]);
  deadline.abort(failure);
  await rejected;
  assert.equal(infoSignal?.aborted, true);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
  const retry = t.mock.fn(async () => {});
  await assert.rejects(f.control.finalize('agent_exit_0', retry), /previously failed/);
  assert.equal(retry.mock.callCount(), 0);
  lookup.reject(new Error('late deadline rejection'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(info.mock.callCount(), 1);
});

test('pre-aborted finalization skips persistence and info and permanently latches failure', async (t) => {
  const f = await fixture(t);
  const cancel = new AbortController();
  const failure = new Error('already canceled');
  cancel.abort(failure);
  const persist = t.mock.fn(async () => {});
  const info = t.mock.method(f.ctx.evalBroker.adapter, 'info');
  await assert.rejects(f.control.finalize('agent_exit_0', persist, cancel.signal), (error) => error === failure);
  await assert.rejects(f.control.finalize('agent_exit_0', persist), /previously failed/);
  assert.equal(persist.mock.callCount(), 0);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('concurrent and repeated finalization reject without rerunning persistence or downgrading success', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  const persistence = deferred<void>();
  const persist = t.mock.fn(() => persistence.promise);
  const info = t.mock.method(f.ctx.evalBroker.adapter, 'info');
  const first = f.control.finalize('agent_claimed_done', persist);
  await assert.rejects(f.control.finalize('agent_exit_0', persist), /already finalizing/);
  assert.equal(persist.mock.callCount(), 1);
  assert.equal(info.mock.callCount(), 0);
  persistence.resolve();
  await first;
  await assert.rejects(f.control.finalize('agent_exit_0', persist), /already finalizing/);
  assert.equal(persist.mock.callCount(), 1);
  assert.equal(info.mock.callCount(), 1);
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
});

test('failed finalization cannot be retried even after control reload', async (t) => {
  const f = await fixture(t);
  const persist = t.mock.fn(async () => { throw new Error('durability failed'); });
  const retry = t.mock.fn(async () => {});
  const info = t.mock.method(f.ctx.evalBroker.adapter, 'info');
  await assert.rejects(f.control.finalize('agent_exit_0', persist), /durability failed/);
  await assert.rejects(f.control.finalize('agent_exit_0', retry), /previously failed/);
  await f.controlPlugin.dispose();
  await f.ctx.plugin(plugin, f.config).await();
  await assert.rejects(f.ctx.evalControl.finalize('agent_exit_0', retry), /previously failed/);
  assert.equal(persist.mock.callCount(), 1);
  assert.equal(retry.mock.callCount(), 0);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('session changes skip info instead of discovering invalidation after an unnecessary lookup', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  const info = t.mock.method(f.ctx.evalBroker.adapter, 'info');
  await assert.rejects(f.control.finalize('agent_claimed_done', async () => {
    f.session.append('turn/start', { turn: 2 });
  }), /changed during finalization/);
  assert.equal(info.mock.callCount(), 0);
  await assert.rejects(f.control.finalize('agent_exit_0', async () => {}), /previously failed/);
});

test('success ignores ordinary session events but trusted adapter failure downgrades it permanently', async (t) => {
  const f = await fixture(t);
  f.completeTurn();
  await f.control.finalize('agent_claimed_done', async () => {});
  const { BundleWriter } = await import('../src/bundle_writer.js');
  const writes = t.mock.method(BundleWriter.prototype, 'flush');
  f.completeTurn(2);
  f.detach();
  f.ctx.sessions.create(SessionId('selected'));
  assert.equal(writes.mock.callCount(), 0);
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
  f.broker.lease.stop('timeout_killed');
  await assert.rejects(async () => {
    for await (const _chunk of f.ctx.evalBroker.adapter.stream({
      provider: 'fixture', model: 'model', sessionId: SessionId('selected'), messages: [],
    })) { /* The stopped broker must reject without model output. */ }
  });
  assert.equal(f.descriptor().stop_reason, 'timeout_killed');
  const retry = t.mock.fn(async () => {});
  await assert.rejects(f.control.finalize('agent_exit_0', retry), /already finalizing/);
  assert.equal(retry.mock.callCount(), 0);
  await f.controlPlugin.dispose();
  assert.equal(f.descriptor().stop_reason, 'timeout_killed');
});

test('one transport rejects a second active control without disturbing its owner', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.ctx.plugin({ ...plugin, name: 'competing-control' }, f.config).await(), /active control owner/);
  f.completeTurn();
  await f.control.finalize('agent_claimed_done', async () => {});
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
});

test('failed installation releases control and writer claims for a later owner', async (t) => {
  const f = await fixture(t);
  await f.controlPlugin.dispose();
  const guard = t.mock.method(f.ctx.tools, 'guard', () => { throw new Error('guard installation failed'); });
  await assert.rejects(f.ctx.plugin({ ...plugin, name: 'failed-control' }, f.config).await(), /guard installation failed/);
  guard.mock.restore();
  await f.ctx.plugin(plugin, f.config).await();
  await f.ctx.evalControl.finalize('agent_exit_0', async () => {});
  assert.equal(f.descriptor().stop_reason, 'infra_error');
});

test('a completed turn finalizes through the official flush barrier', async (t) => {
  // D35 (real chain): the descriptor reported infra_error for a run whose
  // turn completed, because nothing called finalize(). The owner-side
  // finalize must prove durability through the official sessions.flush
  // entry point and record the real terminal reason.
  const f = await fixture(t, { ownerFinalize: true });
  let flushed = 0;
  const originalFlush = f.ctx.sessions.flush.bind(f.ctx.sessions);
  f.ctx.sessions.flush = (async (session: unknown) => {
    flushed += 1;
    return await originalFlush(session as never);
  }) as typeof f.ctx.sessions.flush;

  f.session.append('turn/start', { turn: 1 });
  f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(flushed > 0, true, 'the official flush barrier ran');
  assert.equal(f.descriptor().stop_reason, 'agent_claimed_done');
});
