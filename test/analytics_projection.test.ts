import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { trajectoryAnalyticsProjection, type AnalyticsState } from '../src/analytics/projection.js';

function event(value: Record<string, unknown>): SessionEvent {
  return value as unknown as SessionEvent;
}

test('analytics projection folds turn trends and excludes replacement tool results', () => {
  let state: AnalyticsState = trajectoryAnalyticsProjection.init({ id: 'root' } as never);
  const events: SessionEvent[] = [
    event({ seq: 1, time: 100, type: 'turn/start', data: { turn: 1 } }),
    event({ seq: 2, time: 110, type: 'tool/call', surfaceOp: 'append', data: { turn: 1, step: 1, callId: 'c1', name: 'shell', arguments: 'secret' } }),
    event({ seq: 3, time: 120, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: { toolCallId: 'c1', source: { kind: 'tool', callId: 'c1' }, isError: true, content: [] } } }),
    event({ seq: 4, time: 130, type: 'tool/result', surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 }, sourceEventSeqs: [3], data: { turn: 1, step: 1, message: { toolCallId: 'c1', source: { kind: 'tool', callId: 'c1' }, isError: true, content: [] } } }),
    event({ seq: 5, time: 140, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [] }, stream: [], usage: { inputTokens: 50 } } }),
  ];
  for (const item of events) state = trajectoryAnalyticsProjection.apply(state, item);
  assert.equal(state.toolCalls, 1);
  assert.equal(state.toolResults, 1);
  assert.equal(state.toolErrors, 1);
  assert.equal(state.inputTokens, 50);
  assert.deepEqual(state.turnTrend, [{ turn: 1, toolCalls: 1, toolErrors: 1, retries: 0, compactionStarts: 0, inputTokens: 50 }]);
  assert.doesNotMatch(JSON.stringify(state.recentEvents), /secret/);
});
