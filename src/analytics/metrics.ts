import type { SessionEvent } from '@deepseek-ai/dsh-session';

export interface CanonicalEventRef {
  sessionId: string;
  seq: number;
}

export interface TrajectoryMetricResult {
  metricId: 'tool.call_elapsed_ms' | 'compaction.summary_cycles' | 'compaction.elapsed_ms';
  contractVersion: '1';
  subjectId: string;
  status: 'available' | 'partial' | 'incomplete';
  value?: number | { closedCount: number; openCount: number } | undefined;
  unit?: 'ms' | undefined;
  sampleCount: number;
  denominator?: number | undefined;
  evidenceRefs: CanonicalEventRef[];
  qualityRefs: string[];
  evidenceLevel: 'derived';
}

export interface MetricFoldState {
  sessionId: string;
  openToolCalls: Record<string, { timeMs: number; seq: number }>;
  openCompactions: Record<string, { timeMs: number; seq: number }>;
  compactionStartedCount: number;
  compactionClosedCount: number;
  recentMetricResults: TrajectoryMetricResult[];
}

export const MAX_METRIC_RESULTS = 64;

export function initialMetricFoldState(sessionId: string): MetricFoldState {
  return {
    sessionId,
    openToolCalls: {},
    openCompactions: {},
    compactionStartedCount: 0,
    compactionClosedCount: 0,
    recentMetricResults: [],
  };
}

function upsertResult(
  state: MetricFoldState,
  result: TrajectoryMetricResult,
): MetricFoldState {
  const next = state.recentMetricResults.filter(item =>
    item.metricId !== result.metricId || item.subjectId !== result.subjectId,
  );
  next.push(result);
  return { ...state, recentMetricResults: next.slice(-MAX_METRIC_RESULTS) };
}

function compactionCycleResult(
  state: MetricFoldState,
  sessionId: string,
  ref: CanonicalEventRef,
): TrajectoryMetricResult {
  const openCount = Object.keys(state.openCompactions).length;
  const closedCount = state.compactionClosedCount;
  return {
    metricId: 'compaction.summary_cycles',
    contractVersion: '1',
    subjectId: sessionId,
    status: openCount > 0 ? 'partial' : 'available',
    value: { closedCount, openCount },
    sampleCount: state.compactionStartedCount,
    denominator: state.compactionStartedCount,
    evidenceRefs: [ref],
    qualityRefs: [],
    evidenceLevel: 'derived',
  };
}

/** Incrementally fold the same lifecycle boundaries consumed by aeval v1 reducers. */
export function foldLifecycleMetrics(
  previous: MetricFoldState,
  event: SessionEvent,
): MetricFoldState {
  const sessionId = previous.sessionId;
  const ref = { sessionId, seq: event.seq };
  let state = previous;

  if (event.type === 'tool/call') {
    const callId = String(event.data.callId);
    if (state.openToolCalls[callId]) {
      return upsertResult(state, {
        metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: callId,
        status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [{ sessionId, seq: state.openToolCalls[callId].seq }, ref],
        qualityRefs: ['tool_call_id_duplicate'], evidenceLevel: 'derived',
      });
    }
    state = {
      ...state,
      openToolCalls: { ...state.openToolCalls, [callId]: { timeMs: event.time, seq: event.seq } },
    };
    return upsertResult(state, {
      metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: callId,
      status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
      evidenceRefs: [ref], qualityRefs: ['tool_call_result_missing'], evidenceLevel: 'derived',
    });
  }

  if (event.type === 'tool/result') {
    const message = event.data.message;
    const callId = message.source?.callId ?? message.toolCallId;
    if (callId) {
      const start = state.openToolCalls[String(callId)];
      if (start) {
        const elapsed = event.time - start.timeMs;
        const { [String(callId)]: _removed, ...openToolCalls } = state.openToolCalls;
        state = { ...state, openToolCalls };
        return upsertResult(state, {
          metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: String(callId),
          status: elapsed >= 0 ? 'available' : 'incomplete',
          ...(elapsed >= 0 ? { value: elapsed } : {}), unit: 'ms',
          sampleCount: elapsed >= 0 ? 1 : 0, denominator: 1,
          evidenceRefs: [{ sessionId, seq: start.seq }, ref],
          qualityRefs: elapsed >= 0 ? [] : ['tool_result_precedes_call'],
          evidenceLevel: 'derived',
        });
      }
    }
    return state;
  }

  if (event.type === 'compaction/start') {
    const compactionId = String(event.data.compactionId);
    if (state.openCompactions[compactionId]) {
      return upsertResult(state, {
        metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
        status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [{ sessionId, seq: state.openCompactions[compactionId].seq }, ref],
        qualityRefs: ['compaction_start_duplicate'], evidenceLevel: 'derived',
      });
    }
    state = {
      ...state,
      openCompactions: {
        ...state.openCompactions,
        [compactionId]: { timeMs: event.time, seq: event.seq },
      },
      compactionStartedCount: state.compactionStartedCount + 1,
    };
    state = upsertResult(state, {
      metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
      status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
      evidenceRefs: [ref], qualityRefs: ['compaction_end_missing'], evidenceLevel: 'derived',
    });
    return upsertResult(state, compactionCycleResult(state, sessionId, ref));
  }

  if (event.type === 'compaction/end') {
    const compactionId = String(event.data.compactionId);
    const start = state.openCompactions[compactionId];
    if (!start) return state;
    const elapsed = event.time - start.timeMs;
    const { [compactionId]: _removed, ...openCompactions } = state.openCompactions;
    state = {
      ...state,
      openCompactions,
      compactionClosedCount: state.compactionClosedCount + (elapsed >= 0 ? 1 : 0),
    };
    state = upsertResult(state, {
      metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
      status: elapsed >= 0 ? 'available' : 'incomplete',
      ...(elapsed >= 0 ? { value: elapsed } : {}), unit: 'ms',
      sampleCount: elapsed >= 0 ? 1 : 0, denominator: 1,
      evidenceRefs: [{ sessionId, seq: start.seq }, ref],
      qualityRefs: elapsed >= 0 ? [] : ['compaction_end_precedes_start'],
      evidenceLevel: 'derived',
    });
    return upsertResult(state, compactionCycleResult(state, sessionId, ref));
  }

  return state;
}
