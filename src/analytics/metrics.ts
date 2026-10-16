import type { SessionEvent } from '@deepseek-ai/dsh-session';

export interface CanonicalEventRef {
  sessionId: string;
  seq: number;
}

export interface TrajectoryMetricResult {
  metricId: 'tool.call_elapsed_ms' | 'tool.failure_rate' | 'compaction.summary_cycles' | 'compaction.elapsed_ms' | 'compaction.shadowed_tokens' | 'compaction.prune_passes' | 'context.compaction_frequency_per_1k_input_tokens';
  contractVersion: '1';
  subjectId: string;
  status: 'available' | 'partial' | 'incomplete' | 'unavailable';
  value?: number | { closedCount: number; openCount: number } | undefined;
  unit?: 'ms' | 'tokens' | 'passes' | 'cycles/1k_input_tokens' | undefined;
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
  compactionElapsedMs: number;
  compactionStartRefs: CanonicalEventRef[];
  toolResultByCallId: Record<string, boolean | null>;
  duplicateToolResultIds: Record<string, true>;
  toolResultRefs: CanonicalEventRef[];
  toolResultMissingIdCount: number;
  compactionSummaryById: Record<string, number | null>;
  duplicateCompactionSummaryIds: Record<string, true>;
  compactionSummaryRefs: CanonicalEventRef[];
  compactionSummaryMissingIdCount: number;
  prunePassCount: number;
  pruneEventRefs: CanonicalEventRef[];
  compactionClosedCycleRefs: CanonicalEventRef[];
  modelUsageInputTokens: number;
  modelUsageMissingCount: number;
  modelUsageRefs: CanonicalEventRef[];
  recentMetricResults: TrajectoryMetricResult[];
}

export const MAX_METRIC_RESULTS = 64;

export function isToolResultSurfaceReplacement(event: SessionEvent): boolean {
  if (event.type !== 'tool/result') return false;
  return typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace';
}

export function initialMetricFoldState(sessionId: string): MetricFoldState {
  let state: MetricFoldState = {
    sessionId,
    openToolCalls: {},
    openCompactions: {},
    compactionStartedCount: 0,
    compactionClosedCount: 0,
    compactionElapsedMs: 0,
    compactionStartRefs: [],
    toolResultByCallId: {},
    duplicateToolResultIds: {},
    toolResultRefs: [],
    toolResultMissingIdCount: 0,
    compactionSummaryById: {},
    duplicateCompactionSummaryIds: {},
    compactionSummaryRefs: [],
    compactionSummaryMissingIdCount: 0,
    prunePassCount: 0,
    pruneEventRefs: [],
    compactionClosedCycleRefs: [],
    modelUsageInputTokens: 0,
    modelUsageMissingCount: 0,
    modelUsageRefs: [],
    recentMetricResults: [],
  };
  state = upsertResult(state, compactionCycleResult(state, sessionId));
  state = upsertResult(state, toolFailureRateResult(state));
  state = upsertResult(state, compactionShadowedTokensResult(state));
  state = upsertResult(state, compactionPrunePassesResult(state));
  return upsertResult(state, compactionFrequencyResult(state));
}

function compactionFrequencyResult(state: MetricFoldState): TrajectoryMetricResult {
  const missingOrOpen = state.modelUsageMissingCount > 0 || Object.keys(state.openCompactions).length > 0;
  const status = state.modelUsageInputTokens <= 0 ? 'unavailable' : missingOrOpen ? 'partial' : 'available';
  const evidenceRefs = [...state.compactionClosedCycleRefs, ...state.modelUsageRefs]
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq).slice(-64);
  return {
    metricId: 'context.compaction_frequency_per_1k_input_tokens', contractVersion: '1', subjectId: state.sessionId,
    status,
    ...(state.modelUsageInputTokens > 0 ? { value: 1000 * state.compactionClosedCount / state.modelUsageInputTokens } : {}),
    unit: 'cycles/1k_input_tokens', sampleCount: state.compactionClosedCount,
    denominator: state.modelUsageInputTokens,
    evidenceRefs,
    qualityRefs: [
      ...(state.modelUsageMissingCount ? ['model_input_usage_missing'] : []),
      ...(Object.keys(state.openCompactions).length ? ['compaction_cycle_open'] : []),
    ],
    evidenceLevel: 'derived',
  };
}

function compactionShadowedTokensResult(state: MetricFoldState): TrajectoryMetricResult {
  const unique = Object.entries(state.compactionSummaryById).filter(([id]) => !state.duplicateCompactionSummaryIds[id]);
  const known = unique.filter(([, tokens]) => tokens !== null);
  const qualityRefs = [
    ...(Object.keys(state.duplicateCompactionSummaryIds).length ? ['compaction_summary_id_duplicate'] : []),
    ...(state.compactionSummaryMissingIdCount ? ['compaction_id_missing'] : []),
    ...(unique.some(([, tokens]) => tokens === null) ? ['shadowed_token_count_missing'] : []),
  ];
  const status = known.length === 0 ? 'unavailable'
    : Object.keys(state.duplicateCompactionSummaryIds).length ? 'incomplete'
      : qualityRefs.length ? 'partial' : 'available';
  return {
    metricId: 'compaction.shadowed_tokens', contractVersion: '1', subjectId: state.sessionId,
    status, ...(known.length ? { value: known.reduce((sum, [, tokens]) => sum + (tokens ?? 0), 0) } : {}),
    unit: 'tokens', sampleCount: known.length, denominator: unique.length,
    evidenceRefs: [...state.compactionSummaryRefs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq),
    qualityRefs, evidenceLevel: 'derived',
  };
}

function compactionPrunePassesResult(state: MetricFoldState): TrajectoryMetricResult {
  return {
    metricId: 'compaction.prune_passes', contractVersion: '1', subjectId: state.sessionId,
    status: state.prunePassCount ? 'available' : 'unavailable',
    ...(state.prunePassCount ? { value: state.prunePassCount } : {}),
    unit: 'passes', sampleCount: state.prunePassCount, denominator: state.prunePassCount,
    evidenceRefs: [...state.pruneEventRefs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq),
    qualityRefs: [], evidenceLevel: 'derived',
  };
}

function toolFailureRateResult(state: MetricFoldState): TrajectoryMetricResult {
  const unique = Object.entries(state.toolResultByCallId).filter(([id]) => !state.duplicateToolResultIds[id]);
  const known = unique.filter(([, isError]) => isError !== null);
  const failures = known.filter(([, isError]) => isError === true).length;
  const qualityRefs = [
    ...(Object.keys(state.duplicateToolResultIds).length ? ['tool_result_duplicate'] : []),
    ...(state.toolResultMissingIdCount ? ['tool_result_call_id_missing'] : []),
    ...(unique.some(([, isError]) => isError === null) ? ['tool_result_error_flag_missing'] : []),
  ];
  const status = known.length === 0
    ? 'unavailable'
    : Object.keys(state.duplicateToolResultIds).length
      ? 'incomplete'
      : qualityRefs.length ? 'partial' : 'available';
  return {
    metricId: 'tool.failure_rate', contractVersion: '1', subjectId: state.sessionId,
    status,
    ...(known.length ? { value: failures / known.length } : {}),
    sampleCount: known.length, denominator: known.length,
    evidenceRefs: [...state.toolResultRefs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq),
    qualityRefs, evidenceLevel: 'derived',
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
    evidenceRefs: [...state.compactionStartRefs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq),
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
    if (isToolResultSurfaceReplacement(event)) return state;
    const message = event.data.message;
    const callId = message.source?.callId ?? message.toolCallId;
    const normalizedCallId = callId === undefined ? undefined : String(callId);
    const isError = typeof message.isError === 'boolean' ? message.isError : null;
    if (normalizedCallId) {
      if (state.duplicateToolResultIds[normalizedCallId]) {
        state = { ...state, toolResultRefs: [...state.toolResultRefs, ref].slice(-64) };
        return upsertResult(state, toolFailureRateResult(state));
      }
      if (Object.hasOwn(state.toolResultByCallId, normalizedCallId)) {
        const { [normalizedCallId]: _previous, ...toolResultByCallId } = state.toolResultByCallId;
        state = {
          ...state,
          toolResultByCallId,
          duplicateToolResultIds: { ...state.duplicateToolResultIds, [normalizedCallId]: true },
          toolResultRefs: [...state.toolResultRefs, ref].slice(-64),
        };
        return upsertResult(state, toolFailureRateResult(state));
      }
      state = {
        ...state,
        toolResultByCallId: { ...state.toolResultByCallId, [normalizedCallId]: isError },
        toolResultRefs: [...state.toolResultRefs, ref].slice(-64),
      };
    } else {
      state = { ...state, toolResultMissingIdCount: state.toolResultMissingIdCount + 1, toolResultRefs: [...state.toolResultRefs, ref].slice(-64) };
    }
    if (normalizedCallId) {
      const start = state.openToolCalls[normalizedCallId];
      if (start) {
        const elapsed = event.time - start.timeMs;
        const { [normalizedCallId]: _removed, ...openToolCalls } = state.openToolCalls;
        state = { ...state, openToolCalls };
        state = upsertResult(state, {
          metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: normalizedCallId,
          status: elapsed >= 0 ? 'available' : 'incomplete',
          ...(elapsed >= 0 ? { value: elapsed } : {}), unit: 'ms',
          sampleCount: elapsed >= 0 ? 1 : 0, denominator: 1,
          evidenceRefs: [{ sessionId, seq: start.seq }, ref],
          qualityRefs: elapsed >= 0 ? [] : ['tool_result_precedes_call'],
          evidenceLevel: 'derived',
        });
        return upsertResult(state, toolFailureRateResult(state));
      }
    }
    return upsertResult(state, toolFailureRateResult(state));
  }

  if (event.type === 'assistant/message') {
    const inputTokens = event.data.usage?.inputTokens;
    const known = Number.isSafeInteger(inputTokens) && inputTokens! >= 0;
    state = {
      ...state,
      modelUsageInputTokens: state.modelUsageInputTokens + (known ? inputTokens! : 0),
      modelUsageMissingCount: state.modelUsageMissingCount + (known ? 0 : 1),
      modelUsageRefs: [...state.modelUsageRefs, ref].slice(-64),
    };
    return upsertResult(state, compactionFrequencyResult(state));
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
      compactionStartRefs: [...state.compactionStartRefs, ref].slice(-64),
    };
    state = upsertResult(state, {
      metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
      status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
      evidenceRefs: [ref], qualityRefs: ['compaction_end_missing'], evidenceLevel: 'derived',
    });
    state = upsertResult(state, compactionCycleResult(state, sessionId));
    return upsertResult(state, compactionFrequencyResult(state));
  }

  if (event.type === 'compaction/summary') {
    const compactionId = String(event.data.compactionId ?? '');
    const tokenCount = Number.isSafeInteger(event.data.shadowedTokenCount) ? event.data.shadowedTokenCount : null;
    state = { ...state, compactionSummaryRefs: [...state.compactionSummaryRefs, ref].slice(-64) };
    if (!compactionId) {
      state = { ...state, compactionSummaryMissingIdCount: state.compactionSummaryMissingIdCount + 1 };
    } else if (state.duplicateCompactionSummaryIds[compactionId]) {
      // Keep the original diagnostic state and its evidence ring.
    } else if (Object.hasOwn(state.compactionSummaryById, compactionId)) {
      const { [compactionId]: _previous, ...compactionSummaryById } = state.compactionSummaryById;
      state = { ...state, compactionSummaryById, duplicateCompactionSummaryIds: { ...state.duplicateCompactionSummaryIds, [compactionId]: true } };
    } else {
      state = { ...state, compactionSummaryById: { ...state.compactionSummaryById, [compactionId]: tokenCount } };
    }
    state = upsertResult(state, compactionShadowedTokensResult(state));
    return upsertResult(state, compactionPrunePassesResult(state));
  }

  if (event.type === 'compaction/prune') {
    state = { ...state, prunePassCount: state.prunePassCount + 1, pruneEventRefs: [...state.pruneEventRefs, ref].slice(-64) };
    state = upsertResult(state, compactionPrunePassesResult(state));
    return upsertResult(state, compactionShadowedTokensResult(state));
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
      compactionElapsedMs: state.compactionElapsedMs + (elapsed >= 0 ? elapsed : 0),
      compactionClosedCycleRefs: elapsed >= 0
        ? [...state.compactionClosedCycleRefs, { sessionId, seq: start.seq }, ref].slice(-64)
        : state.compactionClosedCycleRefs,
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
    state = upsertResult(state, compactionCycleResult(state, sessionId));
    return upsertResult(state, compactionFrequencyResult(state));
  }

  return state;
}
