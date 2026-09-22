import assert from 'node:assert/strict';
import { once } from 'node:events';
import { ServerResponse } from 'node:http';
import { createConnection } from 'node:net';
import { setImmediate as turn } from 'node:timers/promises';
import test from 'node:test';
import { BlockAssembler, LlmAdapter, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { GatewayLease, startHostBroker } from '../src/host_broker.js';
import type { HostBroker, HostBrokerOptions } from '../src/host_broker.js';
import { BrokerAdapter, GatewayError, MAX_WIRE_BYTES, parseBrokerRequest, usageTotals } from '../src/gateway_lease.js';

const model: LlmResolvedModelInfo = { provider: 'test', id: 'model', name: 'Offline model', reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } };
const usage: TokenUsage = { inputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 4, reasoningTokens: 2, totalTokens: 14 };
const request = (): GenerateOptions => ({ provider: 'test', model: 'model', sessionId: SessionId('session'), messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const never = <T>(): Promise<T> => new Promise(() => {});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation did not settle')), 1500); })]);
  } finally { clearTimeout(timer); }
}
async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const result: StreamChunk[] = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}
async function* success(): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: 'answer' };
  yield { type: 'usage', usage };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
class OfflineAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(readonly produce: (options: GenerateOptions) => AsyncIterable<StreamChunk> = success) { super(); }
  override async resolveModel() { return model; }
  override stream(options: GenerateOptions) { this.requests.push(options); return this.produce(options); }
}
function policy(upstream: LlmAdapter, overrides: Partial<HostBrokerOptions> = {}): HostBrokerOptions {
  return { trialId: 'trial', sessionId: 'session', configDigest: 'a'.repeat(64), identity: { provider: 'test', model: 'model' }, limits: { maxSteps: 10, maxTokens: 100 }, maxOutputTokens: 20, upstream, inputTokenUpperBound: () => 10, signal: new AbortController().signal, ...overrides };
}
function client(broker?: HostBroker) {
  return new BrokerAdapter({ trialId: 'trial', sessionId: 'session', sessionRoot: '.', configDigest: 'a'.repeat(64), provider: 'test', model: 'model', maxSteps: 10, maxTokens: 100, bundlePath: 'unused', gatewayUrl: broker?.url ?? 'http://127.0.0.1:1', jobTokenFile: 'unused', refuseAuxiliaryCalls: true }, broker?.token ?? 'a'.repeat(64));
}
const rejected = (code: string, reason?: string) => (error: unknown) => error instanceof GatewayError && error.code === code && (reason === undefined || error.stopReason === reason);
const ndjson = (chunks: unknown[]) => chunks.map((chunk) => JSON.stringify(chunk)).join('\n') + '\n';

async function* replayStream(): AsyncIterable<StreamChunk> {
  // First-seen ordering, delta-only assembly, first-close-wins, and truncation
  // pruning are deliberately different from naive block-end collection.
  yield { type: 'reasoning-delta', index: 7, text: 'thought' };
  yield { type: 'tool-call-delta', index: 2, id: ToolCallId('call'), name: 'tool', argumentsDelta: '{' };
  yield { type: 'block-end', index: 9, block: { type: 'text', text: 'answer' } };
  yield { type: 'text-delta', index: 9, text: 'ignored' };
  yield { type: 'usage', usage };
  yield { type: 'finish', reason: { kind: 'max-tokens' }, replayState: { response: { nativeId: 'response-1' }, blocks: [{ signature: 'thought' }, { nativeCall: 'call' }, { nativeText: 'answer' }] } };
}

test('two-turn HTTP replay roundtrips through the real canonical DSH assembler', { timeout: 5000 }, async () => {
  const upstream = new OfflineAdapter(replayStream);
  const broker = await startHostBroker(policy(upstream));
  try {
    const adapter = client(broker);
    const assembler = new BlockAssembler();
    for (const chunk of await collect(adapter.stream(request()))) assembler.push(chunk);
    assert.deepEqual(assembler.blocks(), [{ type: 'reasoning', text: 'thought' }, { type: 'text', text: 'answer' }]);
    assert.deepEqual(assembler.replayState?.blocks, [{ signature: 'thought' }, { nativeText: 'answer' }]);
    const assistant = assembler.message({ provider: 'test', model: 'model', replayState: assembler.replayState });
    await collect(adapter.stream({ ...request(), messages: [...request().messages, assistant] }));
    const sent = upstream.requests[1]!.messages[1]!;
    assert.deepEqual(sent.content, assistant.content);
    assert.deepEqual(sent.source, assistant.source);
    assert.notEqual(sent.source, assistant.source);
    assert.equal(broker.lease.snapshot().usedTokens, 28);
  } finally { await broker.close(); }
});

test('replay rejects unknown, altered, misattributed, cross-lease and content-mismatched state', async () => {
  const upstream = new OfflineAdapter(replayStream);
  const lease = new GatewayLease(policy(upstream, { identity: { provider: 'test', model: 'model', reasoningEffort: 'high' } }), model);
  const assembler = new BlockAssembler();
  for (const chunk of await collect(lease.stream(request(), new AbortController().signal))) assembler.push(chunk);
  const assistant = assembler.message({ provider: 'test', model: 'model', replayState: assembler.replayState });
  const variants = [
    { ...assistant, source: { ...assistant.source, replayState: { response: { nativeId: 'forged' } } } },
    { ...assistant, source: { ...assistant.source, model: 'other' } },
    { ...assistant, source: { ...assistant.source, provider: 'other' } },
    { ...assistant, source: { ...assistant.source, extra: { path: '/host/secret' } } },
    { ...assistant, content: [{ type: 'text', text: 'replacement' }] },
    { ...assistant, source: { ...assistant.source, replayState: { ...assembler.replayState, blocks: [] } } },
  ];
  for (const variant of variants) await assert.rejects(collect(lease.stream({ ...request(), messages: [json(variant)] }, new AbortController().signal)), rejected('AEVAL_UNTRUSTED_REPLAY'));
  await assert.rejects(collect(lease.stream({ ...request(), reasoningEffort: 'low', messages: [assistant] }, new AbortController().signal)), rejected('AEVAL_UNTRUSTED_REPLAY'));
  const other = new GatewayLease(policy(upstream), model);
  await assert.rejects(collect(other.stream({ ...request(), messages: [assistant] }, new AbortController().signal)), rejected('AEVAL_UNTRUSTED_REPLAY'));
  assert.equal(upstream.requests.length, 1);
  await collect(lease.stream({ ...request(), messages: [json(assistant)] }, new AbortController().signal));
  assert.equal(upstream.requests.length, 2);
});

test('assembler-discarded replay envelopes are not authorized', async () => {
  const malformed = new OfflineAdapter(async function* () {
    yield { type: 'text-delta', index: 0, text: 'answer' };
    yield { type: 'usage', usage };
    yield { type: 'finish', reason: { kind: 'stop' }, replayState: { response: 'native', blocks: [] } };
  });
  const issued = new GatewayLease(policy(malformed), model);
  const assembler = new BlockAssembler();
  for (const chunk of await collect(issued.stream(request(), new AbortController().signal))) assembler.push(chunk);
  assert.equal(assembler.replayState, undefined);
  const assistant = assembler.message({ provider: 'test', model: 'model', replayState: { response: 'native', blocks: [] } });
  await assert.rejects(collect(issued.stream({ ...request(), messages: [assistant] }, new AbortController().signal)), rejected('AEVAL_UNTRUSTED_REPLAY'));
});

test('serialized requests continue to reject host attachment references', () => {
  for (const content of [[{ type: 'file', attachment: { path: '/host/secret' } }], [{ type: 'image', attachment: { path: '/host/secret' } }], [{ type: 'text', text: 'safe?', attachment: { path: '/host/secret' } }]]) {
    assert.throws(() => parseBrokerRequest({ ...request(), messages: [{ role: 'user', content }] }), rejected('AEVAL_UNSUPPORTED_CONTENT'));
  }
  assert.throws(() => parseBrokerRequest({ ...request(), messages: [{ role: 'user', content: [], source: { kind: 'user', replayState: {} } }] }), rejected('AEVAL_UNSUPPORTED_REPLAY'));
});

test('meter certifies the exact immutable final dispatch cap and cached usage', async () => {
  const upstream = new OfflineAdapter();
  const measured: Readonly<GenerateOptions>[] = [];
  const lease = new GatewayLease(policy(upstream, { maxOutputTokens: 80, inputTokenUpperBound: (value) => { measured.push(value); return value.maxTokens === 80 ? 30 : 25; } }), model);
  await collect(lease.stream({ ...request(), maxTokens: 90 }, new AbortController().signal));
  assert.deepEqual(measured.map((value) => value.maxTokens), [80, 70]);
  assert.equal(upstream.requests[0], measured[1]);
  assert.ok(Object.isFrozen(measured[1]));
  assert.ok(Object.isFrozen(measured[1]!.messages));
  assert.ok(measured[1]!.signal instanceof AbortSignal);
  assert.deepEqual(usageTotals(usage), { input: 10, total: 14 });
  assert.equal(lease.snapshot().usedTokens, 14);
  assert.equal(lease.snapshot().reservedTokens, 0);
  assert.equal(lease.snapshot().usedSteps, 1);
});

test('a cap-dependent bound that no longer fits refuses after exactly two measurements', async () => {
  const upstream = new OfflineAdapter();
  let measured = 0;
  const lease = new GatewayLease(policy(upstream, { maxOutputTokens: 80, inputTokenUpperBound: () => ++measured === 1 ? 30 : 31 }), model);
  await assert.rejects(collect(lease.stream(request(), new AbortController().signal)), rejected('AEVAL_BUDGET_EXHAUSTED', 'budget_exhausted'));
  assert.equal(measured, 2);
  assert.equal(upstream.requests.length, 0);
  assert.equal(lease.snapshot().usedTokens, 0);
  assert.equal(lease.snapshot().usedSteps, 0);
});

for (const mode of ['owner', 'client', 'close'] as const) test(`${mode} cancellation interrupts a hung meter and contains late rejection`, { timeout: 5000 }, async () => {
  const entered = deferred<AbortSignal>();
  const pending = deferred<number>();
  const owner = new AbortController();
  const caller = new AbortController();
  const upstream = new OfflineAdapter();
  const stops: string[] = [];
  const broker = await startHostBroker(policy(upstream, { signal: owner.signal, inputTokenUpperBound: (value) => { entered.resolve(value.signal!); return pending.promise; }, onStop: (reason) => { stops.push(reason); throw new Error('observer failed'); } }));
  try {
    const running = collect(broker.lease.stream(request(), caller.signal));
    const failure = assert.rejects(running, (error: unknown) => error instanceof GatewayError);
    const signal = await promptly(entered.promise);
    if (mode === 'owner') owner.abort();
    else if (mode === 'client') caller.abort();
    else await promptly(broker.close('timeout_killed'));
    await promptly(failure);
    assert.equal(signal.aborted, true);
    assert.equal(upstream.requests.length, 0);
    assert.equal(broker.lease.snapshot().usedTokens, 0);
    assert.equal(stops.length, 1);
    pending.reject(new Error('late meter failure'));
    await turn();
  } finally { await promptly(broker.close()); }
});

test('close resolves an active HTTP handler whose meter ignores cancellation', { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const broker = await startHostBroker(policy(new OfflineAdapter(), { inputTokenUpperBound: () => { entered.resolve(); return never<number>(); } }));
  const running = collect(client(broker).stream(request()));
  const failure = assert.rejects(running);
  await promptly(entered.promise);
  await promptly(broker.close('timeout_killed'));
  await promptly(failure);
  assert.equal(broker.lease.snapshot().stopReason, 'timeout_killed');
});

test('owner timeout aborts hung EOF cleanup, withholds finish and charges the reservation', { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const cleanup = deferred<void>();
  const upstream = new OfflineAdapter(async function* () {
    try { yield* success(); }
    finally { entered.resolve(); await cleanup.promise; }
  });
  const lease = new GatewayLease(policy(upstream), model);
  const seen: StreamChunk[] = [];
  const running = (async () => { for await (const chunk of lease.stream(request(), new AbortController().signal)) seen.push(chunk); })();
  const failure = assert.rejects(running, (error: unknown) => error instanceof GatewayError && error.stopReason === 'timeout_killed');
  await promptly(entered.promise);
  lease.stop('timeout_killed');
  await promptly(failure);
  assert.equal(seen.some((chunk) => chunk.type === 'finish'), false);
  assert.equal(lease.snapshot().usedTokens, 30);
  assert.equal(lease.snapshot().reservedTokens, 0);
  assert.equal(upstream.requests[0]!.signal!.aborted, true);
  cleanup.reject(new Error('late iterator cleanup failure'));
  await turn();
});

test('aborted EOF cannot produce a successful terminal', async () => {
  const caller = new AbortController();
  const upstream = new OfflineAdapter(async function* () { yield* success(); caller.abort(); });
  const lease = new GatewayLease(policy(upstream), model);
  const seen: StreamChunk[] = [];
  await assert.rejects((async () => { for await (const chunk of lease.stream(request(), caller.signal)) seen.push(chunk); })());
  assert.equal(seen.some((chunk) => chunk.type === 'finish'), false);
  assert.equal(lease.snapshot().usedTokens, 30);
});

test('hung next and hung or rejecting return do not delay cancellation', async () => {
  for (const rejectReturn of [false, true]) {
    const entered = deferred<void>();
    const pending = deferred<IteratorResult<StreamChunk>>();
    let returned = 0;
    const upstream = new OfflineAdapter(() => ({ [Symbol.asyncIterator]: () => ({ next: () => { entered.resolve(); return pending.promise; }, return: () => { returned++; return rejectReturn ? Promise.reject(new Error('return failed')) : never<IteratorResult<StreamChunk>>(); } }) }));
    const lease = new GatewayLease(policy(upstream), model);
    const running = collect(lease.stream(request(), new AbortController().signal));
    const failure = assert.rejects(running);
    await promptly(entered.promise);
    lease.stop('timeout_killed');
    await promptly(failure);
    assert.equal(returned, 1);
    assert.equal(lease.snapshot().usedTokens, 30);
    pending.reject(new Error('late next failure'));
    await turn();
  }
});

test('busy requests neither dispatch nor stop the active lease', async () => {
  const entered = deferred<void>();
  const proceed = deferred<void>();
  const upstream = new OfflineAdapter(async function* () { entered.resolve(); await proceed.promise; yield* success(); });
  const lease = new GatewayLease(policy(upstream), model);
  const running = collect(lease.stream(request(), new AbortController().signal));
  await promptly(entered.promise);
  assert.equal(lease.snapshot().reservedTokens, 30);
  await assert.rejects(collect(lease.stream(request(), new AbortController().signal)), rejected('AEVAL_LEASE_BUSY'));
  assert.equal(lease.signal.aborted, false);
  assert.equal(upstream.requests.length, 1);
  proceed.resolve();
  await promptly(running);
  assert.equal(lease.snapshot().usedSteps, 1);
});

test('cached input exceeding the certified bound charges conservatively and stops', async () => {
  const upstream = new OfflineAdapter(async function* () { yield { type: 'usage', usage: { inputTokens: 1, cacheReadTokens: 31, outputTokens: 1, totalTokens: 33 } }; });
  const lease = new GatewayLease(policy(upstream), model);
  await assert.rejects(collect(lease.stream(request(), new AbortController().signal)), rejected('AEVAL_TOKEN_BOUND_VIOLATED'));
  assert.equal(lease.snapshot().usedTokens, 33);
  assert.equal(lease.snapshot().stopReason, 'infra_error');
});

for (const reason of ['budget_exhausted', 'timeout_killed'] as const) test(`client notifies ${reason} exactly once and contains throwing listeners`, async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 422, headers: { 'aeval-stop-reason': reason, 'aeval-error-code': 'AEVAL_BUDGET_EXHAUSTED' } }));
  const adapter = client();
  const seen: string[] = [];
  adapter.observeTerminal(() => { throw new Error('listener failed'); });
  adapter.observeTerminal(async () => { throw new Error('async listener failed'); });
  adapter.observeTerminal((value) => seen.push(value));
  await assert.rejects(collect(adapter.stream(request())), rejected('AEVAL_BUDGET_EXHAUSTED', reason));
  assert.deepEqual(seen, [reason]);
  await turn();
});

test('client preserves in-band budget failure without a second generic notification', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(ndjson([{ type: 'gateway-error', stopReason: 'budget_exhausted' }])));
  const adapter = client();
  const seen: string[] = [];
  adapter.observeTerminal((reason) => seen.push(reason));
  await assert.rejects(collect(adapter.stream(request())), rejected('AEVAL_GATEWAY_FAILED', 'budget_exhausted'));
  assert.deepEqual(seen, ['budget_exhausted']);
});

test('client enforces cancellation before a buffered terminal and before EOF success', async (t) => {
  for (const atEof of [false, true]) {
    const caller = new AbortController();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(Buffer.from(ndjson([{ type: 'usage', usage }, { type: 'finish', reason: { kind: 'stop' } }])));
      else { caller.abort(new GatewayError('AEVAL_LEASE_CLOSED', 'timeout_killed')); controller.close(); }
    } }, { highWaterMark: 0 });
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(body));
    const adapter = client();
    const seen: string[] = [];
    adapter.observeTerminal((reason) => seen.push(reason));
    const stream = adapter.stream({ ...request(), signal: caller.signal })[Symbol.asyncIterator]();
    assert.equal((await stream.next()).value?.type, 'usage');
    if (!atEof) caller.abort(new GatewayError('AEVAL_LEASE_CLOSED', 'timeout_killed'));
    await assert.rejects(stream.next(), rejected('AEVAL_LEASE_CLOSED', 'timeout_killed'));
    assert.deepEqual(seen, ['timeout_killed']);
    mocked.mock.restore();
  }
});

test('client cancellation and early return do not wait for hung reader cleanup', async (t) => {
  const cancelled = deferred<void>();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from(ndjson([{ type: 'text-delta', index: 0, text: 'hello' }]))); }, cancel() { cancelled.resolve(); return never<void>(); } });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const adapter = client();
  const seen: string[] = [];
  adapter.observeTerminal((reason) => seen.push(reason));
  const stream = adapter.stream(request())[Symbol.asyncIterator]();
  await stream.next();
  await promptly(stream.return!());
  await promptly(cancelled.promise);
  assert.deepEqual(seen, ['infra_error']);
});

test('consumer return after timeout retains that reason instead of infra_error', async (t) => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.from(ndjson([{ type: 'text-delta', index: 0, text: 'hello' }]))); } });
  t.mock.method(globalThis, 'fetch', async () => new Response(body));
  const caller = new AbortController();
  const adapter = client();
  const seen: string[] = [];
  adapter.observeTerminal((reason) => seen.push(reason));
  const stream = adapter.stream({ ...request(), signal: caller.signal })[Symbol.asyncIterator]();
  await stream.next();
  caller.abort(new GatewayError('AEVAL_LEASE_CLOSED', 'timeout_killed'));
  await promptly(stream.return!());
  assert.deepEqual(seen, ['timeout_killed']);
});

test('coalesced valid NDJSON lines may exceed the per-line limit together', async (t) => {
  const text = 'x'.repeat(MAX_WIRE_BYTES / 2);
  const payload = ndjson([{ type: 'text-delta', index: 0, text }, { type: 'text-delta', index: 0, text }, { type: 'usage', usage }, { type: 'finish', reason: { kind: 'stop' } }]);
  assert.ok(Buffer.byteLength(payload) > MAX_WIRE_BYTES);
  t.mock.method(globalThis, 'fetch', async () => new Response(payload));
  const seen: string[] = [];
  const adapter = client();
  adapter.observeTerminal((reason) => seen.push(reason));
  assert.equal((await collect(adapter.stream(request()))).length, 4);
  assert.deepEqual(seen, []);
});

test('malformed, oversized, invalid UTF-8 and truncated NDJSON fail once', async (t) => {
  const goodUsage = { type: 'usage', usage };
  const finish = { type: 'finish', reason: { kind: 'stop' } };
  const invalid: (string | Uint8Array)[] = [
    '\n', '{broken}\n', ndjson([goodUsage]), ndjson([finish]), JSON.stringify(goodUsage),
    ndjson([goodUsage, goodUsage, finish]), ndjson([goodUsage, finish, finish]),
    ndjson([goodUsage, { type: 'text-delta', index: 0, text: 'late' }, finish]),
    ndjson([{ type: 'text-delta', index: 0, text: 'x'.repeat(MAX_WIRE_BYTES) }]),
    'x'.repeat(MAX_WIRE_BYTES), new Uint8Array([0xff, 10]),
    ndjson([goodUsage, { type: 'finish', reason: { kind: 'error', failure: { code: 'FAILED', message: 'failure' } } }]),
  ];
  for (const payload of invalid) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => new Response(typeof payload === 'string' ? payload : Buffer.from(payload)));
    const adapter = client();
    const seen: string[] = [];
    adapter.observeTerminal((reason) => seen.push(reason));
    await assert.rejects(collect(adapter.stream(request())), (error: unknown) => error instanceof GatewayError);
    assert.deepEqual(seen, ['infra_error']);
    mocked.mock.restore();
  }
});

test('HTTP budget errors retain the authoritative stop reason', { timeout: 5000 }, async () => {
  const broker = await startHostBroker(policy(new OfflineAdapter(), { limits: { maxTokens: 5 } }));
  try {
    const adapter = client(broker);
    const seen: string[] = [];
    adapter.observeTerminal((reason) => seen.push(reason));
    await assert.rejects(collect(adapter.stream(request())), (error: unknown) => error instanceof GatewayError && error.stopReason === 'budget_exhausted');
    assert.deepEqual(seen, ['budget_exhausted']);
  } finally { await promptly(broker.close()); }
});

test('HTTP timeout interrupts a hung upstream and reports timeout once', { timeout: 5000 }, async () => {
  const entered = deferred<void>();
  const broker = await startHostBroker(policy(new OfflineAdapter(async function* () { entered.resolve(); await never<void>(); }), { timeoutMs: 50 }));
  try {
    const adapter = client(broker);
    const seen: string[] = [];
    adapter.observeTerminal((reason) => seen.push(reason));
    const running = collect(adapter.stream(request()));
    const failure = assert.rejects(running, (error: unknown) => error instanceof GatewayError && error.stopReason === 'timeout_killed');
    await promptly(entered.promise);
    await promptly(failure);
    assert.deepEqual(seen, ['timeout_killed']);
    assert.equal(broker.lease.snapshot().usedTokens, 30);
  } finally { await promptly(broker.close()); }
});

test('close cancels an incomplete HTTP request body', { timeout: 5000 }, async () => {
  const broker = await startHostBroker(policy(new OfflineAdapter()));
  const socket = createConnection(Number(new URL(broker.url).port), '127.0.0.1');
  socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    socket.write(`POST /stream HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${broker.token}\r\nContent-Type: application/json\r\nContent-Length: 10000\r\n\r\n{`);
    await turn();
    await promptly(broker.close('timeout_killed'));
  } finally { socket.destroy(); await broker.close(); }
});

test('lease stop cancels a real paused-client HTTP drain and destroys its response', { timeout: 5000 }, async (t) => {
  const blocked = deferred<ServerResponse>();
  const original = ServerResponse.prototype.write;
  t.mock.method(ServerResponse.prototype, 'write', function (this: ServerResponse, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args) as boolean;
    if (!result) blocked.resolve(this);
    return result;
  });
  const upstream = new OfflineAdapter(async function* () {
    yield { type: 'text-delta', index: 0, text: 'x'.repeat(6 * 1024 * 1024) };
    await never<void>();
  });
  const broker = await startHostBroker(policy(upstream));
  const socket = createConnection(Number(new URL(broker.url).port), '127.0.0.1');
  socket.on('error', () => {});
  socket.pause();
  try {
    await once(socket, 'connect');
    const body = JSON.stringify(request());
    socket.write(`POST /stream HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${broker.token}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const response = await promptly(blocked.promise);
    assert.equal(response.writableNeedDrain, true);
    broker.lease.stop('timeout_killed');
    assert.equal(response.destroyed, true);
    await promptly(broker.close());
    assert.equal(broker.lease.snapshot().usedTokens, 30);
    assert.equal(upstream.requests[0]!.signal!.aborted, true);
  } finally { socket.destroy(); await broker.close(); }
});
