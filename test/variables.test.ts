import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { agentEvents, assembleContextFor, type Agent } from '@deepseek-ai/dsh-agent';
import { ReasoningEffortId, ToolCallId, type LlmCallConfig } from '@deepseek-ai/dsh-llm';
import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime';
import { createScope } from '@deepseek-ai/dsh-scope';
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime, defineContentToolFixture, type ToolPresentationMode } from '@deepseek-ai/dsh-tools';
import { agentOptionsOf, installExperimentVariables } from '../src/variable_inject.js';
import type { EvalControlConfig } from '../src/config.js';

function config(overrides: Partial<EvalControlConfig> = {}): EvalControlConfig {
  return {
    trialId: 'trial', sessionId: 'selected', sessionRoot: 'sessions/selected',
    configDigest: 'a'.repeat(64), provider: 'experiment-provider', model: 'experiment-model',
    gatewayUrl: 'http://localhost:9000', jobTokenFile: '/job-token',
    bundlePath: 'bundle_descriptor.json', refuseAuxiliaryCalls: true,
    ...overrides,
  };
}

const inherited = Object.freeze({
  provider: 'inherited-provider', model: 'inherited-model',
  reasoningEffort: ReasoningEffortId('inherited-effort'), maxTokens: 321, temperature: 0.4,
});

function fixture(t: TestContext, mode: ToolPresentationMode = 'native') {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  new SystemPrompt(ctx, { includeHarnessIdentity: false });
  new ToolRuntime(ctx, { mode });
  new SessionStore(ctx);
  ctx.systemPrompt.variable('provider', ({ agent }) => agent?.options.provider);
  ctx.systemPrompt.variable('model', ({ agent }) => agent?.options.model);
  ctx.on('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const assembly = await next();
    return { ...assembly, variables: { ...assembly.variables, reasoningEffort: agent?.options.reasoningEffort } };
  });
  const bodies: string[] = [];
  const register = (owner: Context, name: string) => owner.tools.register(defineContentToolFixture({
    name, description: name, parameters: {},
    async execute() { bodies.push(name); return [{ type: 'text', text: name }]; },
  }));
  register(ctx, 'read');
  register(ctx, 'write');
  const makeAgent = (name: string) => {
    const id = SessionId(name);
    const agent = { id, session: ctx.sessions.create(id), options: inherited } as unknown as Agent;
    const scope = createScope(ctx, agent);
    Object.defineProperty(agent, 'ctx', { value: scope.ctx });
    return agent;
  };
  const selected = makeAgent('selected');
  const unrelated = makeAgent('selected-other');
  register(selected.ctx, 'scoped');
  register(unrelated.ctx, 'scoped');
  const assemble = (agent: Agent) => ctx.systemPrompt.assemble(assembleContextFor(agent));
  const request = (agent: Agent, base: LlmCallConfig = inherited) => agentEvents(ctx, agent).waterfall(
    'agent/request', { turn: 1, step: 1, signal: new AbortController().signal }, async () => base,
  );
  const execute = (name: string, agent?: Agent) => ctx.tools.execute({
    callId: ToolCallId(`call-${name}`), name, arguments: {},
    ...(agent === undefined ? {} : { agent }), signal: new AbortController().signal,
  });
  const install = async (value: EvalControlConfig) => ctx.plugin({
    name: 'experiment-test', inject: ['tools'],
    apply(pluginCtx: Context) { installExperimentVariables(pluginCtx, value); },
  }).await();
  return { ctx, selected, unrelated, assemble, request, execute, register, bodies, install };
}

class PresentationRuntime extends PtcRuntime {
  readonly language = 'typescript';
  readonly isolation = 'fixture';
  resolve(): never { throw new Error('PTC execution must not be reached'); }
  async run(): Promise<never> { throw new Error('PTC execution must not be reached'); }
}

test('agentOptionsOf contains identity only, with a constructed optional effort', () => {
  assert.deepEqual(agentOptionsOf(config({ maxSteps: 1, maxTokens: 2 })), {
    provider: 'experiment-provider', model: 'experiment-model',
  });
  assert.deepEqual(agentOptionsOf(config({ reasoningEffort: 'high' })), {
    provider: 'experiment-provider', model: 'experiment-model', reasoningEffort: ReasoningEffortId('high'),
  });
});

for (const effort of [undefined, 'high']) {
  test(`prepended waterfalls replace final identity; effort=${effort ?? 'absent'}`, async (t) => {
    const f = fixture(t);
    let returnedVariables: Record<string, string | undefined> | undefined;
    let returnedRequest: LlmCallConfig | undefined;
    f.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next();
      returnedVariables = Object.freeze({ ...result.variables, model: 'downstream-model', keep: 'yes' });
      return Object.freeze({ ...result, variables: returnedVariables });
    });
    f.ctx.on('agent/request', async (_payload, next) => {
      returnedRequest = Object.freeze({ ...await next(), model: 'downstream-model' });
      return returnedRequest;
    });
    await f.install(config({ ...(effort === undefined ? {} : { reasoningEffort: effort }), maxTokens: 1 }));
    const assembly = await f.assemble(f.selected);
    const request = await f.request(f.selected);
    assert.equal(assembly.variables.provider, 'experiment-provider');
    assert.equal(assembly.variables.model, 'experiment-model');
    assert.equal(assembly.variables.reasoningEffort, effort);
    assert.equal(Object.hasOwn(assembly.variables, 'reasoningEffort'), effort !== undefined);
    assert.equal(assembly.variables.keep, 'yes');
    assert.equal(request.provider, 'experiment-provider');
    assert.equal(request.model, 'experiment-model');
    assert.equal(request.reasoningEffort, effort);
    assert.equal(Object.hasOwn(request, 'reasoningEffort'), effort !== undefined);
    assert.equal(request.maxTokens, 321);
    assert.equal(request.temperature, 0.4);
    assert.equal(returnedVariables?.model, 'downstream-model');
    assert.equal(returnedRequest?.model, 'downstream-model');
    assert.equal(f.selected.options, inherited);
    assert.equal(f.selected.session.seq, 0);
    assert.equal((await f.assemble(f.unrelated)).variables.model, 'downstream-model');
    assert.equal((await f.request(f.unrelated)).reasoningEffort, 'inherited-effort');
  });
}

test('filters final schemas, including scoped tools, with deny winning; guard cannot be force-allowed', async (t) => {
  const f = fixture(t);
  f.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
    ...await next(), tools: f.ctx.tools.schemas(f.selected),
  }));
  await f.install(config({ tools: { allow: ['read', 'write', 'scoped'], deny: ['write', 'scoped'] } }));
  f.ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }));
  assert.deepEqual((await f.assemble(f.selected)).tools.map((tool) => tool.name), ['read']);
  assert.equal((await f.execute('read', f.selected)).isError, false);
  for (const name of ['write', 'scoped']) {
    const result = await f.execute(name, f.selected);
    assert.equal(result.isError, true);
    if (result.isError) assert.match(result.error.message, /disallowed/);
  }
  assert.deepEqual(f.bodies, ['read']);
  assert.equal((await f.execute('scoped', f.unrelated)).isError, false);
  assert.equal((await f.execute('write')).isError, false);
  assert.deepEqual(f.ctx.tools.schemas(f.selected).map((tool) => tool.name).sort(), ['read', 'scoped', 'write']);
});

for (const tools of [{ allow: [] }, { deny: ['write', 'scoped'] }, undefined]) {
  test(`tool policy preserves empty allow and optional masks: ${JSON.stringify(tools)}`, async (t) => {
    const f = fixture(t);
    await f.install(config(tools === undefined ? {} : { tools }));
    const expected = tools === undefined ? ['read', 'scoped', 'write'] : 'allow' in tools ? [] : ['read'];
    assert.deepEqual((await f.assemble(f.selected)).tools.map((tool) => tool.name), expected);
    assert.equal((await f.execute('scoped', f.selected)).isError, tools !== undefined);
    assert.equal((await f.execute('read', f.selected)).isError, tools !== undefined && 'allow' in tools);
    assert.deepEqual((await f.assemble(f.unrelated)).tools.map((tool) => tool.name), ['read', 'scoped', 'write']);
    assert.equal(await f.request(f.unrelated), inherited);
    assert.equal((await f.ctx.systemPrompt.assemble()).variables.provider, undefined);
  });
}

test('global listeners work through a filtered plugin context', async (t) => {
  const f = fixture(t);
  const hidden = f.ctx.extend({ [Context.filter]: () => false });
  await hidden.plugin({
    name: 'filtered-experiment', inject: ['tools'],
    apply(ctx: Context) { installExperimentVariables(ctx, config({ tools: { allow: [] } })); },
  }).await();
  assert.equal((await f.request(f.selected)).provider, 'experiment-provider');
  assert.equal((await f.assemble(f.selected)).variables.model, 'experiment-model');
  assert.deepEqual((await f.assemble(f.selected)).tools, []);
});

test('unload and failed plugin startup roll back both waterfalls and the execution guard', async (t) => {
  const f = fixture(t);
  const plugin = await f.install(config({ tools: { allow: [] } }));
  assert.equal((await f.execute('scoped', f.selected)).isError, true);
  await plugin.dispose();
  assert.equal(await f.request(f.selected), inherited);
  assert.equal((await f.assemble(f.selected)).variables.model, 'inherited-model');
  assert.equal((await f.execute('scoped', f.selected)).isError, false);
  const failed = f.ctx.plugin({
    name: 'failed-experiment', inject: ['tools'],
    apply(ctx: Context) {
      installExperimentVariables(ctx, config({ tools: { allow: [] } }));
      throw new Error('abort plugin installation');
    },
  });
  await assert.rejects(failed.await(), /abort plugin installation/);
  assert.equal(await f.request(f.selected), inherited);
  assert.equal((await f.assemble(f.selected)).tools.length, 3);
  assert.equal((await f.execute('scoped', f.selected)).isError, false);
  assert.equal(f.selected.session.seq, 0);
});

for (const mode of ['ptc', 'both'] as const) {
  test(`rejects ${mode} for only the matching agent and respects scoped native overrides`, async (t) => {
    const f = fixture(t, mode);
    new PresentationRuntime(f.ctx);
    await f.install(config({ tools: { allow: ['read', 'run_code'] } }));
    await assert.rejects(f.assemble(f.selected), /requires native mode/);
    await assert.rejects(f.request(f.selected), /requires native mode/);
    const result = await f.execute('run_code', f.selected);
    assert.equal(result.isError, true);
    if (result.isError) assert.match(result.error.message, /requires native mode/);
    assert.equal(await f.request(f.unrelated), inherited);
    assert.ok((await f.assemble(f.unrelated)).tools.some((tool) => tool.name === 'run_code'));
    const restore = f.selected.ctx.tools.presentAs('native');
    assert.deepEqual((await f.assemble(f.selected)).tools.map((tool) => tool.name), ['read']);
    assert.equal((await f.request(f.selected)).model, 'experiment-model');
    assert.equal((await f.execute('read', f.selected)).isError, false);
    restore();
    await assert.rejects(f.request(f.selected), /requires native mode/);
  });

  test(`rejects scoped ${mode} even under a native deployment`, async (t) => {
    const f = fixture(t);
    new PresentationRuntime(f.ctx);
    await f.install(config({ tools: { deny: ['write'] } }));
    f.selected.ctx.tools.presentAs(mode);
    await assert.rejects(f.assemble(f.selected), /requires native mode/);
    await assert.rejects(f.request(f.selected), /requires native mode/);
    assert.equal((await f.execute('run_code', f.selected)).isError, true);
    assert.equal((await f.execute('write', f.unrelated)).isError, false);
  });
}

test('rejects scoped installation rather than leaking or silently narrowing host policy', async (t) => {
  const f = fixture(t);
  assert.throws(() => installExperimentVariables(f.selected.ctx, config()), /global host context/);
  assert.equal(await f.request(f.selected), inherited);
  assert.equal((await f.execute('scoped', f.selected)).isError, false);
});
