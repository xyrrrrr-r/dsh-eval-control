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
