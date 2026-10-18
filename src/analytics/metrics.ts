import { createHash } from 'node:crypto';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { assistantStreamFirstTokenTime } from '@deepseek-ai/dsh-llm/assistant-stream';

export interface CanonicalEventRef {
  sessionId: string;
  seq: number;
}

export type TrajectoryMetricId =
  | 'tool.call_elapsed_ms'
  | 'tool.failure_rate'
  | 'compaction.summary_cycles'
  | 'compaction.elapsed_ms'
  | 'compaction.shadowed_tokens'
  | 'compaction.prune_passes'
  | 'compaction.reclaimed_tokens_per_call_token'
  | 'context.compaction_frequency_per_1k_input_tokens'
  | 'context.compaction_time_share'
  | 'context.input_window_utilization'
  | 'model.step_to_first_chunk_ms'
  | 'model.stream_span_ms'
  | 'model.retry_recovery'
  | 'model.long_gap_segments'
  | 'tool.repeat_loop'
  | 'tool.error_recovery'
  | 'tool.repeat_overhead'
  | 'planning.todo_snapshot_change'
  | 'planning.rewrite_after_completion'
  | 'coordination.inbox_insert_to_message_event_ms'
  | 'coordination.inbox_tool_overlap_share'
  | 'coordination.team_delivery_ms'
  | 'coordination.delegation_depth'
  | 'coordination.fan_out_width'
  | 'coordination.member_idle_ms'
  | 'coordination.task_blocked_duration'
  | 'coordination.team_path_critical_segments'
  | 'coordination.member_busy_ms'
  | 'coordination.active_members_now'
  | 'coordination.peak_concurrent_members'
  | 'coordination.team_completion_wall_ms'
  | 'coordination.branch_first_activity_ms'
  | 'outcome.turn_reason_mix'
  | 'outcome.turn_completion_evidence'
  | 'data_quality.trajectory_coverage';

/** Runtime mirror of {@link TrajectoryMetricId}; the compile-time assertion
 * below fails when a family is added to the union without extending this list. */
export const TRAJECTORY_METRIC_IDS = [
  'tool.call_elapsed_ms',
  'tool.failure_rate',
  'compaction.summary_cycles',
  'compaction.elapsed_ms',
  'compaction.shadowed_tokens',
  'compaction.prune_passes',
  'compaction.reclaimed_tokens_per_call_token',
  'context.compaction_frequency_per_1k_input_tokens',
  'context.compaction_time_share',
  'context.input_window_utilization',
  'model.step_to_first_chunk_ms',
  'model.stream_span_ms',
  'model.retry_recovery',
  'model.long_gap_segments',
  'tool.repeat_loop',
  'tool.error_recovery',
  'tool.repeat_overhead',
  'planning.todo_snapshot_change',
  'planning.rewrite_after_completion',
  'coordination.inbox_insert_to_message_event_ms',
  'coordination.inbox_tool_overlap_share',
  'coordination.team_delivery_ms',
  'coordination.delegation_depth',
  'coordination.fan_out_width',
  'coordination.member_idle_ms',
  'coordination.task_blocked_duration',
  'coordination.team_path_critical_segments',
  'coordination.member_busy_ms',
  'coordination.active_members_now',
  'coordination.peak_concurrent_members',
  'coordination.team_completion_wall_ms',
  'coordination.branch_first_activity_ms',
  'outcome.turn_reason_mix',
  'outcome.turn_completion_evidence',
  'data_quality.trajectory_coverage',
] as const satisfies readonly TrajectoryMetricId[];
type _TrajectoryMetricIdsExhaustive =
  [TrajectoryMetricId] extends [typeof TRAJECTORY_METRIC_IDS[number]]
    ? [typeof TRAJECTORY_METRIC_IDS[number]] extends [TrajectoryMetricId]
      ? true
      : ['TRraJECTORY_METRIC_IDS carries an id outside the union']
    : ['TrajectoryMetricId family missing from TRAJECTORY_METRIC_IDS'];

export interface SummaryCyclesValue { closedCount: number; openCount: number }
export interface RetryRecoveryValue { retries: number; recovered: boolean; wallMs: number }
export interface LongGapValue { gapCount: number; gapMs: number; attributedMs: number; unattributedMs: number }
export interface RepeatLoopValue { loopCount: number; repeatedCalls: number; maxRunLength: number }
export interface ErrorRecoveryValue { recovered: boolean; retryCalls: number; recoveryMs?: number }
export interface RepeatOverheadValue { repeatCalls: number; overheadMs: number }
export interface TodoSnapshotChangeValue { snapshotCount: number; structuralChanges: number; statusChanges: number; goalRevisions: number }
export interface RewriteAfterCompletionValue { rewriteCount: number }
export interface CriticalSegmentsValue { segments: string[]; observedDurationMs: number }
export interface CoverageValue { unknownEventTypes: number; unpairedToolResults: number; openSpans: number; qualityIssueCount: number; qualityCodes: string[] }
export interface TurnCompletionEvidenceValue { turns: number; turnsWithDeliverables: number; deliverableCount: number; [kind: string]: number }

/**
 * Wire-shaped metric value: a scalar or a record of scalars / string lists /
 * booleans. The concrete interfaces below document the shapes each metric
 * family produces; they are structural subtypes of this loose union.
 */
export type MetricValue = number | Record<string, number | string[] | boolean>;

export interface TrajectoryMetricResult {
  metricId: TrajectoryMetricId;
  contractVersion: '1';
  subjectId: string;
  status: 'available' | 'partial' | 'incomplete' | 'unavailable';
  value?: MetricValue | undefined;
  unit?: 'ms' | 'tokens' | 'passes' | 'cycles/1k_input_tokens' | 'share' | 'shadowed_tokens_per_call_token' | undefined;
  sampleCount: number;
  denominator?: number | undefined;
  evidenceRefs: CanonicalEventRef[];
  qualityRefs: string[];
  evidenceLevel: 'observed' | 'derived' | 'inferred';
}

export interface ToolCallObservation {
  callId: string | null;
  digest: string | null;
  timeMs: number;
  seq: number;
}

export interface ToolResultObservation {
  callId: string | null;
  isError: boolean | null;
  timeMs: number;
  seq: number;
}

export interface TurnInterval {
  turn: number;
  startMs: number;
  startSeq: number;
  /** First turn/end event for this turn, regardless of ordering. */
  firstEndMs: number | null;
  firstEndSeq: number | null;
}

export interface TodoSnapshotObservation {
  items: Array<{ digest: string; status: string }>;
  ref: CanonicalEventRef;
}

export interface TaskSnapshotObservation {
  taskId: string | null;
  status: string | null;
  blockedBy: string[] | null;
  timeMs: number;
  ref: CanonicalEventRef;
}

export interface MemberSnapshotObservation {
  memberId: string | null;
  phase: string | null;
  timeMs: number;
  ref: CanonicalEventRef;
}

export interface SubagentChildObservation {
  childId: string | null;
  childCreatedAtMs: number | null;
  ref: CanonicalEventRef;
}

export interface RetryGroupObservation {
  retryId: string;
  turn: number | null;
  step: number | null;
  firstTimeMs: number;
  firstSeq: number;
  lastTimeMs: number;
  lastSeq: number;
  count: number;
  refs: CanonicalEventRef[];
}

export interface ModelUsageObservation {
  turn: number | null;
  step: number | null;
  inputTokens: number | null;
  timeMs: number;
  seq: number;
  ref: CanonicalEventRef;
}

export interface RouteObservation {
  provider: string | null;
  model: string | null;
  seq: number;
  ref: CanonicalEventRef;
}

export interface ContextWindowObservation {
  provider: string | null;
  model: string | null;
  contextWindow: number | null;
  seq: number;
  ref: CanonicalEventRef;
}

export interface QualityItem {
  code: string;
  refs: CanonicalEventRef[];
}

export interface MetricFoldState {
  sessionId: string;
  /** True event window, including events that produce no canonical fact. */
  firstEventTimeMs: number | null;
  lastEventTimeMs: number | null;
  lastEventRef: CanonicalEventRef | null;
  eventCount: number;
  delegationDepth: number | null;
  sealed: boolean;
  /** One entry per canonical fact (an event may produce several). */
  factTimes: number[];
  factRefs: CanonicalEventRef[];
  stepStarts: Record<string, { timeMs: number; seq: number }>;
  stepTokens: Record<string, Array<{ timeMs: number; seq: number }>>;
  stepEnded: Record<string, true>;
  turnIntervals: TurnInterval[];
  turnEndReasons: Array<{ reasonKind: string | null; ref: CanonicalEventRef }>;
  turnBoundaryDuplicateRefs: CanonicalEventRef[];
  orphanTurnEndRefs: Record<string, CanonicalEventRef>;
  toolCallObservations: ToolCallObservation[];
  toolResultObservations: ToolResultObservation[];
  toolResultByCallId: Record<string, boolean | null>;
  duplicateToolResultIds: Record<string, true>;
  toolResultRefs: CanonicalEventRef[];
  toolResultMissingIdCount: number;
  compactionStartsById: Record<string, { timeMs: number; seq: number }>;
  compactionStartRefsById: Record<string, CanonicalEventRef[]>;
  compactionStartMissingIdRefs: CanonicalEventRef[];
  compactionEndsById: Record<string, { timeMs: number; seq: number }>;
  compactionSummaryById: Record<string, number | null>;
  compactionSummaryEvents: Array<{ compactionId: string; shadowed: number | null; total: number | null; ref: CanonicalEventRef }>;
  duplicateCompactionSummaryIds: Record<string, true>;
  compactionSummaryRefs: CanonicalEventRef[];
  compactionSummaryMissingIdCount: number;
  prunePassCount: number;
  pruneEventRefs: CanonicalEventRef[];
  modelUsageObservations: ModelUsageObservation[];
  modelUsageInputTokens: number;
  modelUsageMissingCount: number;
  modelUsageRefs: CanonicalEventRef[];
  retryGroups: RetryGroupObservation[];
  streamSpans: Array<{ key: string; startMs: number; endMs: number; ref: CanonicalEventRef }>;
  routeObservations: RouteObservation[];
  contextWindowObservations: ContextWindowObservation[];
  approvalAsks: Record<string, { askMs: number; askSeq: number }>;
  approvalEnds: Record<string, { decidedMs: number; decidedSeq: number }>;
  deliverableTurns: Array<{ turn: number | null; fileCount: number | null; ref: CanonicalEventRef }>;
  todoSnapshots: TodoSnapshotObservation[];
  goalChangeRefs: CanonicalEventRef[];
  inboxInserts: Array<{ messageIds: string[]; timeMs: number; seq: number; ref: CanonicalEventRef }>;
  surfacedMessages: Array<{ messageId: string | null; timeMs: number; seq: number; ref: CanonicalEventRef }>;
  teamMemberIds: string[];
  teamMemberSnapshotRefs: CanonicalEventRef[];
  teamMemberSnapshots: MemberSnapshotObservation[];
  subagentChildren: SubagentChildObservation[];
  taskSnapshots: TaskSnapshotObservation[];
  queuedTeamMessages: Array<{ messageId: string | null; timeMs: number; ref: CanonicalEventRef }>;
  deliveredTeamMessages: Array<{ messageId: string | null; timeMs: number; ref: CanonicalEventRef }>;
  /** Event-time quality items; derived codes are rebuilt on every recompute. */
  qualityItems: QualityItem[];
  unknownEventTypes: Record<string, CanonicalEventRef>;
  recentMetricResults: TrajectoryMetricResult[];
}

export const MAX_METRIC_RESULTS = 64;
/** Frozen display threshold for model.long_gap_segments (milliseconds). */
export const LONG_GAP_THRESHOLD_MS = 30_000;
/** Frozen repeat-loop rule: a run counts from this many identical calls. */
export const REPEAT_LOOP_MIN_RUN = 3;

/** ``KNOWN_SESSION_EVENT_TYPES`` of the pinned 0.2.0-rc.2 build; mirrors aeval's vocabulary. */
export const OFFICIAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent-preset/selected', 'agent/inbox/spliced', 'approval/asked', 'approval/decided',
  'approval/policy', 'assistant/attempt', 'assistant/message', 'command/done', 'command/run',
  'compaction/end', 'compaction/prune', 'compaction/start', 'compaction/summary',
  'deliverables/presented', 'developer/message', 'feedback/message-delete',
  'feedback/message-put', 'feedback/record', 'goal/change', 'hook/invoked', 'hook/result',
  'image/offload', 'llm/retry', 'llm/retry-started', 'model/selection', 'permission/preset',
  'plan/mode', 'request/context', 'request/header', 'sandbox/mode', 'schedule/change',
  'session-log-deepseek/delivery-accepted', 'session/end-seed', 'session/title',
  'session/title-llm-request', 'step/end', 'step/start', 'subagent/catalog',
  'subagent/descriptor', 'subagent/model-selection-policy', 'system/message', 'team/member',
  'team/message/delivered', 'team/message/queued', 'team/task', 'todo/write',
  'tool-workflow/agent-end', 'tool-workflow/agent-start', 'tool-workflow/run-end',
  'tool-workflow/run-start', 'tool/call', 'tool/ptc-dispatch', 'tool/ptc-dispatch-start',
  'tool/result', 'turn/end', 'turn/start', 'user/message',
  'web/deepseek-search-llm-request', 'workspace/changes',
]);

/** Quality codes whose items are derived from the whole current state. */
const DERIVED_QUALITY_CODES = new Set([
  'tool_result_precedes_call',
  'compaction_end_precedes_start',
  'approval_end_precedes_start',
  'turn_end_precedes_start',
  'turn_end_without_start',
  'blocked_by_task_not_observed',
]);

/** SHA-256 truncated to 16 bytes, hex — the exact construction aeval normalizes with. */
export function truncatedDigest(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}

/** Privacy-minimized identity of one tool call: name plus exact arguments, digested. */
export function toolCallDigest(name: unknown, args: unknown): string | null {
  if (typeof name !== 'string') return null;
  return truncatedDigest(`${name}\x1f${typeof args === 'string' ? args : ''}`);
}

/** Privacy-minimized identity of one todo item's content (status stays separate). */
export function todoItemDigest(content: unknown): string | null {
  if (typeof content !== 'string') return null;
  return truncatedDigest(content);
}

export function isToolResultSurfaceReplacement(event: SessionEvent): boolean {
  if (event.type !== 'tool/result') return false;
  return typeof event.surfaceOp === 'object' && event.surfaceOp.op === 'replace';
}

function refOf(sessionId: string, seq: number): CanonicalEventRef {
  return { sessionId, seq };
}

function sortRefs(refs: CanonicalEventRef[]): CanonicalEventRef[] {
  return [...refs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq);
}

function lastRefs(refs: CanonicalEventRef[], cap = 64): CanonicalEventRef[] {
  return sortRefs(refs).slice(-cap);
}

function uniqueRefs(refs: CanonicalEventRef[], cap = 64): CanonicalEventRef[] {
  const unique = new Map<string, CanonicalEventRef>();
  for (const ref of refs) unique.set(`${ref.sessionId}:${ref.seq}`, ref);
  return sortRefs([...unique.values()]).slice(-cap);
}

function unionIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  const normalized = intervals.filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const interval of normalized) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      if (interval[1] > last[1]) last[1] = interval[1];
    } else {
      merged.push([interval[0], interval[1]]);
    }
  }
  return merged;
}

function overlapMeasure(intervals: Array<[number, number]>, window: [number, number]): number {
  const [start, end] = window;
  if (end <= start) return 0;
  let total = 0;
  for (const [itemStart, itemEnd] of unionIntervals(intervals)) {
    total += Math.max(0, Math.min(itemEnd, end) - Math.max(itemStart, start));
  }
  return total;
}

function streamTimeBounds(stream: unknown): { startMs: number; endMs: number } | null {
  if (!Array.isArray(stream)) return null;
  let first: number | null = null;
  let last: number | null = null;
  const observe = (start: number, end: number) => {
    if (first === null || start < first) first = start;
    if (last === null || end > last) last = end;
  };
  for (const record of stream) {
    if (typeof record !== 'object' || record === null) continue;
    const entry = record as { type?: unknown; time?: unknown; time0?: unknown; dt?: unknown };
    if (entry.type === 'chunk') {
      if (typeof entry.time === 'number') observe(entry.time, entry.time);
      continue;
    }
    if (typeof entry.time0 !== 'number') continue;
    let end = entry.time0;
    if (Array.isArray(entry.dt)) {
      for (const delta of entry.dt) if (typeof delta === 'number' && delta > 0) end += delta;
    }
    observe(entry.time0, end);
  }
  if (first === null || last === null || last < first) return null;
  return { startMs: first, endMs: last };
}

/** aeval's ``_count``: non-negative safe integers only. */
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** aeval's ``_nonempty``. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Python's f-string of a missing turn/step renders "None"; span keys must match. */
function spanKeyPart(value: unknown): string {
  return value === undefined || value === null ? 'None' : String(value);
}

function stepKey(turn: number, step: number): string { return `${turn}:${step}`; }

export interface InitialFoldOptions {
  delegationDepth?: number | null;
}

export function initialMetricFoldState(sessionId: string, options: InitialFoldOptions = {}): MetricFoldState {
  const state: MetricFoldState = {
    sessionId,
    firstEventTimeMs: null,
    lastEventTimeMs: null,
    lastEventRef: null,
    eventCount: 0,
    delegationDepth: typeof options.delegationDepth === 'number' && options.delegationDepth >= 0 ? options.delegationDepth : null,
    sealed: false,
    factTimes: [],
    factRefs: [],
    stepStarts: {},
    stepTokens: {},
    stepEnded: {},
    turnIntervals: [],
    turnEndReasons: [],
    turnBoundaryDuplicateRefs: [],
    orphanTurnEndRefs: {},
    toolCallObservations: [],
    toolResultObservations: [],
    toolResultByCallId: {},
    duplicateToolResultIds: {},
    toolResultRefs: [],
    toolResultMissingIdCount: 0,
    compactionStartsById: {},
    compactionStartRefsById: {},
    compactionStartMissingIdRefs: [],
    compactionEndsById: {},
    compactionSummaryById: {},
    compactionSummaryEvents: [],
    duplicateCompactionSummaryIds: {},
    compactionSummaryRefs: [],
    compactionSummaryMissingIdCount: 0,
    prunePassCount: 0,
    pruneEventRefs: [],
    modelUsageObservations: [],
    modelUsageInputTokens: 0,
    modelUsageMissingCount: 0,
    modelUsageRefs: [],
    retryGroups: [],
    streamSpans: [],
    routeObservations: [],
    contextWindowObservations: [],
    approvalAsks: {},
    approvalEnds: {},
    deliverableTurns: [],
    todoSnapshots: [],
    goalChangeRefs: [],
    inboxInserts: [],
    surfacedMessages: [],
    teamMemberIds: [],
    teamMemberSnapshotRefs: [],
    teamMemberSnapshots: [],
    subagentChildren: [],
    taskSnapshots: [],
    queuedTeamMessages: [],
    deliveredTeamMessages: [],
    qualityItems: [],
    unknownEventTypes: {},
    recentMetricResults: [],
  };
  return recomputeSessionResults(state);
}

function upsertResult(
  state: MetricFoldState,
  result: TrajectoryMetricResult,
): MetricFoldState {
  const next = state.recentMetricResults.filter(item =>
    item.metricId !== result.metricId || item.subjectId !== result.subjectId,
  );
  next.push(result);
  // Session-scoped aggregate rows carry ``subjectId === sessionId`` (one row
  // per metric family, so the exemption stays bounded) and feed the client's
  // summary cards. Per-subject detail rows keep the LRU window; without the
  // exemption, sessions past the window size would evict every aggregate —
  // they are upserted first in ``recomputeSessionResults`` and therefore
  // always fall out of the trailing slice first on long sessions.
  const sessionRows = next.filter(item => item.subjectId === state.sessionId);
  const detailRows = next.filter(item => item.subjectId !== state.sessionId);
  return { ...state, recentMetricResults: [...sessionRows, ...detailRows.slice(-MAX_METRIC_RESULTS)] };
}

// --- derived views over state ------------------------------------------------

function firstCallByCallId(state: MetricFoldState): Map<string, ToolCallObservation> {
  const map = new Map<string, ToolCallObservation>();
  for (const call of state.toolCallObservations) {
    if (call.callId !== null && !map.has(call.callId)) map.set(call.callId, call);
  }
  return map;
}

function lastCallByCallId(state: MetricFoldState): Map<string, ToolCallObservation> {
  const map = new Map<string, ToolCallObservation>();
  for (const call of state.toolCallObservations) {
    if (call.callId !== null) map.set(call.callId, call);
  }
  return map;
}

function firstResultByCallId(state: MetricFoldState): Map<string, ToolResultObservation> {
  const map = new Map<string, ToolResultObservation>();
  for (const result of state.toolResultObservations) {
    if (result.callId !== null && !map.has(result.callId)) map.set(result.callId, result);
  }
  return map;
}

/** True when the callId's first result closes the first call's span. */
function closedToolSpan(
  firstCalls: Map<string, ToolCallObservation>,
  firstResults: Map<string, ToolResultObservation>,
  callId: string,
): { endMs: number; endSeq: number } | null {
  const call = firstCalls.get(callId);
  const result = firstResults.get(callId);
  if (!call || !result) return null;
  if (result.timeMs < call.timeMs) return null;
  return { endMs: result.timeMs, endSeq: result.seq };
}

function closedCompactionIds(state: MetricFoldState): string[] {
  return Object.keys(state.compactionStartsById).filter(id => {
    const start = state.compactionStartsById[id]!;
    const end = state.compactionEndsById[id];
    return end !== undefined && end.timeMs >= start.timeMs;
  });
}

/** Tool lifecycles as half-open intervals; open calls extend to ``openEndMs``. */
function toolIntervalList(state: MetricFoldState, openEndMs: number): Array<[number, number]> {
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  const intervals: Array<[number, number]> = [];
  for (const [callId, call] of firstCalls) {
    const closed = closedToolSpan(firstCalls, firstResults, callId);
    intervals.push([call.timeMs, closed ? closed.endMs : openEndMs]);
  }
  return intervals;
}

function compactionIntervalList(state: MetricFoldState, openEndMs: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const [compactionId, start] of Object.entries(state.compactionStartsById)) {
    const end = state.compactionEndsById[compactionId];
    intervals.push([start.timeMs, end && end.timeMs >= start.timeMs ? end.timeMs : openEndMs]);
  }
  return intervals;
}

function approvalIntervalList(state: MetricFoldState, openEndMs: number): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  for (const [requestId, ask] of Object.entries(state.approvalAsks)) {
    const end = state.approvalEnds[requestId];
    intervals.push([ask.askMs, end && end.decidedMs >= ask.askMs ? end.decidedMs : openEndMs]);
  }
  return intervals;
}

/** All fact times in event order, plus the session_observed fact at the last event. */
function sessionFactTimes(state: MetricFoldState): number[] {
  if (state.eventCount === 0) return [];
  return [...state.factTimes, state.lastEventTimeMs!];
}

function sessionFactRefs(state: MetricFoldState): CanonicalEventRef[] {
  if (state.eventCount === 0) return [];
  return state.lastEventRef ? [...state.factRefs, state.lastEventRef] : state.factRefs;
}

// --- per-session result builders ---------------------------------------------

function summaryCyclesResult(state: MetricFoldState): TrajectoryMetricResult {
  const startIds = Object.keys(state.compactionStartRefsById);
  const missing = state.compactionStartMissingIdRefs;
  const closed = new Set(closedCompactionIds(state));
  const openIds = startIds.filter(id => !closed.has(id));
  const duplicated = startIds.filter(id => (state.compactionStartRefsById[id]?.length ?? 0) > 1);
  const codes = new Set(state.qualityItems.map(item => item.code));
  const dupCodes = [...codes].filter(code => code === 'compaction_start_duplicate' || code === 'compaction_end_duplicate').sort();
  const qualityRefs: string[] = [...dupCodes];
  if (missing.length) qualityRefs.push('compaction_id_missing');
  const status = missing.length || duplicated.length || dupCodes.length
    ? 'incomplete'
    : openIds.length ? 'partial' : 'available';
  const refs = [
    ...startIds.flatMap(id => state.compactionStartRefsById[id] ?? []),
    ...missing,
  ];
  return {
    metricId: 'compaction.summary_cycles', contractVersion: '1', subjectId: state.sessionId,
    status, value: { closedCount: closed.size, openCount: openIds.length },
    sampleCount: startIds.length + missing.length, denominator: startIds.length + missing.length,
    evidenceRefs: lastRefs(refs), qualityRefs, evidenceLevel: 'derived',
  };
}

function compactionFrequencyResult(state: MetricFoldState): TrajectoryMetricResult {
  const usages = state.modelUsageObservations;
  const denominator = usages.reduce((sum, usage) => sum + (usage.inputTokens ?? 0), 0);
  const closed = closedCompactionIds(state);
  const openCount = Object.keys(state.compactionStartsById).length - closed.length;
  const qualityRefs = [
    ...(usages.some(usage => usage.inputTokens === null) ? ['model_input_usage_missing'] : []),
    ...(openCount > 0 ? ['compaction_cycle_open'] : []),
  ].sort();
  const spanRefs: CanonicalEventRef[] = [];
  for (const id of closed) {
    spanRefs.push(refOf(state.sessionId, state.compactionStartsById[id]!.seq));
    spanRefs.push(refOf(state.sessionId, state.compactionEndsById[id]!.seq));
  }
  const status = denominator <= 0 ? 'unavailable' : qualityRefs.length ? 'partial' : 'available';
  return {
    metricId: 'context.compaction_frequency_per_1k_input_tokens', contractVersion: '1', subjectId: state.sessionId,
    status,
    ...(denominator > 0 ? { value: 1000 * closed.length / denominator } : {}),
    unit: 'cycles/1k_input_tokens', sampleCount: closed.length, denominator,
    evidenceRefs: lastRefs([...spanRefs, ...state.modelUsageRefs]),
    qualityRefs, evidenceLevel: 'derived',
  };
}

function compactionShadowedTokensResult(state: MetricFoldState): TrajectoryMetricResult {
  const unique = Object.entries(state.compactionSummaryById).filter(([id]) => !state.duplicateCompactionSummaryIds[id]);
  const known = unique.filter(([, tokens]) => tokens !== null);
  const qualityRefs = [
    ...(Object.keys(state.duplicateCompactionSummaryIds).length ? ['compaction_summary_id_duplicate'] : []),
    ...(state.compactionSummaryMissingIdCount ? ['compaction_id_missing'] : []),
    ...(unique.some(([, tokens]) => tokens === null) ? ['shadowed_token_count_missing'] : []),
  ].sort();
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

function compactionElapsedResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const results: TrajectoryMetricResult[] = [];
  for (const [compactionId, start] of Object.entries(state.compactionStartsById)) {
    const end = state.compactionEndsById[compactionId];
    if (end && end.timeMs >= start.timeMs) {
      results.push({
        metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
        status: 'available', value: end.timeMs - start.timeMs, unit: 'ms',
        sampleCount: 1, denominator: 1,
        evidenceRefs: [refOf(state.sessionId, start.seq), refOf(state.sessionId, end.seq)],
        qualityRefs: [], evidenceLevel: 'derived',
      });
    } else {
      results.push({
        metricId: 'compaction.elapsed_ms', contractVersion: '1', subjectId: compactionId,
        status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [refOf(state.sessionId, start.seq)],
        qualityRefs: ['compaction_end_missing'], evidenceLevel: 'derived',
      });
    }
  }
  return results;
}

function toolFailureRateResult(state: MetricFoldState): TrajectoryMetricResult {
  const unique = Object.entries(state.toolResultByCallId).filter(([id]) => !state.duplicateToolResultIds[id]);
  const known = unique.filter(([, isError]) => isError !== null);
  const failures = known.filter(([, isError]) => isError === true).length;
  const qualityRefs = [
    ...(Object.keys(state.duplicateToolResultIds).length ? ['tool_result_duplicate'] : []),
    ...(state.toolResultMissingIdCount ? ['tool_result_call_id_missing'] : []),
    ...(unique.some(([, isError]) => isError === null) ? ['tool_result_error_flag_missing'] : []),
  ].sort();
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

function toolCallElapsedResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  const results: TrajectoryMetricResult[] = [];
  for (const [callId, call] of firstCalls) {
    const closed = closedToolSpan(firstCalls, firstResults, callId);
    const refs = closed
      ? [refOf(state.sessionId, call.seq), refOf(state.sessionId, closed.endSeq)]
      : [refOf(state.sessionId, call.seq)];
    const duplicateCodes = new Set<string>();
    for (const item of state.qualityItems) {
      if (item.code !== 'tool_call_id_duplicate' && item.code !== 'tool_result_duplicate') continue;
      const relevant = item.refs.some(ref =>
        (ref.sessionId === state.sessionId && ref.seq === call.seq)
        || (closed !== null && ref.sessionId === state.sessionId && ref.seq === closed.endSeq),
      );
      if (relevant) duplicateCodes.add(item.code);
    }
    if (duplicateCodes.size) {
      results.push({
        metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: callId,
        status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: refs, qualityRefs: [...duplicateCodes].sort(), evidenceLevel: 'derived',
      });
    } else if (closed) {
      results.push({
        metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: callId,
        status: 'available', value: closed.endMs - call.timeMs, unit: 'ms',
        sampleCount: 1, denominator: 1, evidenceRefs: refs,
        qualityRefs: [], evidenceLevel: 'derived',
      });
    } else {
      results.push({
        metricId: 'tool.call_elapsed_ms', contractVersion: '1', subjectId: callId,
        status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: refs, qualityRefs: ['tool_call_result_missing'], evidenceLevel: 'derived',
      });
    }
  }
  return results;
}

function stepToFirstChunkResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const results: TrajectoryMetricResult[] = [];
  for (const [key, start] of Object.entries(state.stepStarts)) {
    const candidates = (state.stepTokens[key] ?? []).filter(token => token.timeMs >= start.timeMs);
    let token: { timeMs: number; seq: number } | null = null;
    for (const candidate of candidates) {
      if (token === null || candidate.timeMs < token.timeMs) token = candidate;
    }
    const subjectId = `${state.sessionId}:${key}`;
    if (token) {
      results.push({
        metricId: 'model.step_to_first_chunk_ms', contractVersion: '1', subjectId,
        status: 'available', value: token.timeMs - start.timeMs, unit: 'ms',
        sampleCount: 1, denominator: 1,
        evidenceRefs: [refOf(state.sessionId, start.seq), refOf(state.sessionId, token.seq)],
        qualityRefs: [], evidenceLevel: 'derived',
      });
    } else {
      results.push({
        metricId: 'model.step_to_first_chunk_ms', contractVersion: '1', subjectId,
        status: state.stepEnded[key] || state.sealed ? 'incomplete' : 'unavailable',
        unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [refOf(state.sessionId, start.seq)],
        qualityRefs: ['step_first_token_missing'], evidenceLevel: 'derived',
      });
    }
  }
  return results;
}

function streamSpanResults(state: MetricFoldState): TrajectoryMetricResult[] {
  return state.streamSpans.map(span => {
    const elapsed = span.endMs - span.startMs;
    if (elapsed > 0) {
      return {
        metricId: 'model.stream_span_ms', contractVersion: '1', subjectId: span.key,
        status: 'available', value: elapsed, unit: 'ms',
        sampleCount: 1, denominator: 1, evidenceRefs: [span.ref],
        qualityRefs: [], evidenceLevel: 'derived',
      };
    }
    return {
      metricId: 'model.stream_span_ms', contractVersion: '1', subjectId: span.key,
      status: 'partial', unit: 'ms', sampleCount: 0, denominator: 1,
      evidenceRefs: [span.ref], qualityRefs: ['model_stream_zero_width'], evidenceLevel: 'derived',
    };
  });
}

function reclaimedTokensResults(state: MetricFoldState): TrajectoryMetricResult[] {
  return state.compactionSummaryEvents.map(summary => {
    if (summary.shadowed !== null && summary.total !== null && summary.total > 0) {
      return {
        metricId: 'compaction.reclaimed_tokens_per_call_token', contractVersion: '1', subjectId: summary.compactionId,
        status: 'available', value: summary.shadowed / summary.total, unit: 'shadowed_tokens_per_call_token',
        sampleCount: 1, denominator: 1, evidenceRefs: [summary.ref], qualityRefs: [], evidenceLevel: 'derived',
      };
    }
    return {
      metricId: 'compaction.reclaimed_tokens_per_call_token', contractVersion: '1', subjectId: summary.compactionId,
      status: 'unavailable', unit: 'shadowed_tokens_per_call_token', sampleCount: 0, denominator: 1,
      evidenceRefs: [summary.ref],
      qualityRefs: [summary.shadowed === null ? 'shadowed_token_count_missing' : 'compaction_usage_total_missing'],
      evidenceLevel: 'derived',
    };
  });
}

function compactionTimeShareResult(state: MetricFoldState): TrajectoryMetricResult {
  const windowStart = state.firstEventTimeMs;
  const windowEnd = state.lastEventTimeMs;
  if (windowStart === null || windowEnd === null || windowEnd <= windowStart) {
    return {
      metricId: 'context.compaction_time_share', contractVersion: '1', subjectId: state.sessionId,
      status: 'unavailable', unit: 'share', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  const intervals = compactionIntervalList(state, windowEnd);
  const covered = overlapMeasure(intervals, [windowStart, windowEnd]);
  const spanRefs: CanonicalEventRef[] = [];
  for (const [compactionId, start] of Object.entries(state.compactionStartsById)) {
    spanRefs.push(refOf(state.sessionId, start.seq));
    const end = state.compactionEndsById[compactionId];
    if (end && end.timeMs >= start.timeMs) spanRefs.push(refOf(state.sessionId, end.seq));
  }
  return {
    metricId: 'context.compaction_time_share', contractVersion: '1', subjectId: state.sessionId,
    status: 'available', value: covered / (windowEnd - windowStart), unit: 'share',
    sampleCount: intervals.length, denominator: windowEnd - windowStart,
    evidenceRefs: uniqueRefs(spanRefs), qualityRefs: [], evidenceLevel: 'derived',
  };
}

function inputWindowUtilizationResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const routes = [...state.routeObservations].sort((a, b) => a.seq - b.seq);
  const windows = [...state.contextWindowObservations].sort((a, b) => a.seq - b.seq);
  const routeKeys = new Set(routes.map(route => JSON.stringify([route.provider, route.model])));
  const routeConflicts = routeKeys.size > 1;
  const windowKeys = new Map<string, Set<string>>();
  for (const window of windows) {
    const key = JSON.stringify([window.provider, window.model]);
    const set = windowKeys.get(key) ?? new Set<string>();
    set.add(JSON.stringify(window.contextWindow));
    windowKeys.set(key, set);
  }
  const windowConflicts = [...windowKeys.entries()].some(([, set]) => set.size > 1);
  const results: TrajectoryMetricResult[] = [];
  for (const usage of state.modelUsageObservations) {
    if (usage.inputTokens === null) continue;
    const priorRoutes = routes.filter(route => route.seq < usage.seq);
    const route = priorRoutes[priorRoutes.length - 1];
    const provider = route?.provider ?? null;
    const model = route?.model ?? null;
    const priorWindows = windows.filter(
      window => window.seq < usage.seq && window.provider === provider && window.model === model,
    );
    const capacity = priorWindows[priorWindows.length - 1];
    const window = capacity?.contextWindow ?? null;
    const refs: CanonicalEventRef[] = [usage.ref];
    if (route) refs.push(route.ref);
    if (capacity) refs.push(capacity.ref);
    if (window === null || window <= 0) {
      const quality = new Set<string>(['context_window_missing']);
      if (!route) quality.add('request_route_missing');
      results.push({
        metricId: 'context.input_window_utilization', contractVersion: '1', subjectId: `${state.sessionId}:${usage.seq}`,
        status: 'unavailable', unit: 'share', sampleCount: 1, denominator: 1,
        evidenceRefs: lastRefs(refs), qualityRefs: [...quality].sort(), evidenceLevel: 'derived',
      });
      continue;
    }
    let status: TrajectoryMetricResult['status'] = 'available';
    const quality = new Set<string>();
    if (routeConflicts) {
      status = 'partial';
      quality.add('context_window_route_ambiguous');
    }
    if (windowConflicts) {
      status = 'partial';
      quality.add('context_window_conflict');
    }
    if (!route) {
      status = 'partial';
      quality.add('request_route_missing');
    }
    results.push({
      metricId: 'context.input_window_utilization', contractVersion: '1', subjectId: `${state.sessionId}:${usage.seq}`,
      status, value: usage.inputTokens / window, unit: 'share', sampleCount: 1, denominator: 1,
      evidenceRefs: lastRefs(refs), qualityRefs: [...quality].sort(), evidenceLevel: 'derived',
    });
  }
  return results;
}

function retryRecoveryResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const results: TrajectoryMetricResult[] = [];
  for (const group of state.retryGroups) {
    const candidates = state.modelUsageObservations.filter(
      usage => usage.turn === group.turn && usage.step === group.step && usage.seq > group.lastSeq,
    ).sort((a, b) => a.seq - b.seq);
    const recovery = candidates[0];
    const refs = [...group.refs];
    if (recovery) refs.push(recovery.ref);
    const recovered = recovery !== undefined;
    const wallMs = recovery ? recovery.timeMs - group.firstTimeMs : group.lastTimeMs - group.firstTimeMs;
    results.push({
      metricId: 'model.retry_recovery', contractVersion: '1', subjectId: `${state.sessionId}:${group.retryId}`,
      status: recovered || state.sealed ? 'available' : 'partial',
      value: { retries: group.count, recovered, wallMs },
      sampleCount: group.count, denominator: group.count,
      evidenceRefs: uniqueRefs(refs),
      qualityRefs: recovered ? [] : ['model_retry_unrecovered'],
      evidenceLevel: 'derived',
    });
  }
  return results;
}

function longGapResult(state: MetricFoldState): TrajectoryMetricResult {
  const factTimes = sessionFactTimes(state);
  if (factTimes.length < 2) {
    return {
      metricId: 'model.long_gap_segments', contractVersion: '1', subjectId: state.sessionId,
      status: 'unavailable', unit: 'ms', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  const windowEnd = state.lastEventTimeMs!;
  const attribution = [
    ...toolIntervalList(state, windowEnd),
    ...compactionIntervalList(state, windowEnd),
    ...approvalIntervalList(state, windowEnd),
  ];
  const gaps: Array<[number, number]> = [];
  for (let index = 1; index < factTimes.length; index += 1) {
    const start = factTimes[index - 1]!;
    const end = factTimes[index]!;
    if (end - start >= LONG_GAP_THRESHOLD_MS) gaps.push([start, end]);
  }
  const gapMs = gaps.reduce((sum, [start, end]) => sum + (end - start), 0);
  const attributed = gaps.reduce((sum, gap) => sum + overlapMeasure(attribution, gap), 0);
  return {
    metricId: 'model.long_gap_segments', contractVersion: '1', subjectId: state.sessionId,
    status: gaps.length ? 'available' : 'unavailable',
    ...(gaps.length ? { value: { gapCount: gaps.length, gapMs, attributedMs: attributed, unattributedMs: gapMs - attributed } } : {}),
    unit: 'ms', sampleCount: gaps.length, denominator: factTimes.length,
    evidenceRefs: lastRefs(sessionFactRefs(state)), qualityRefs: [], evidenceLevel: 'inferred',
  };
}

function repeatLoopResult(state: MetricFoldState): TrajectoryMetricResult {
  const calls = state.toolCallObservations;
  const runs: ToolCallObservation[][] = [];
  for (const call of calls) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.digest === call.digest) last.push(call);
    else runs.push([call]);
  }
  const loops = runs.filter(run => run.length >= REPEAT_LOOP_MIN_RUN);
  return {
    metricId: 'tool.repeat_loop', contractVersion: '1', subjectId: state.sessionId,
    status: calls.length ? 'available' : 'unavailable',
    ...(calls.length ? {
      value: {
        loopCount: loops.length,
        repeatedCalls: loops.reduce((sum, run) => sum + run.length, 0),
        maxRunLength: runs.reduce((max, run) => Math.max(max, run.length), 0),
      },
    } : {}),
    sampleCount: calls.length, denominator: calls.length,
    evidenceRefs: lastRefs(loops.flatMap(run => run.map(call => refOf(state.sessionId, call.seq)))),
    qualityRefs: [], evidenceLevel: 'derived',
  };
}

function errorRecoveryResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const lastCalls = lastCallByCallId(state);
  const results: TrajectoryMetricResult[] = [];
  for (const error of state.toolResultObservations) {
    if (error.isError !== true || error.callId === null) continue;
    const call = lastCalls.get(error.callId);
    const digest = call?.digest ?? null;
    let later: ToolCallObservation[] = [];
    if (digest !== null) {
      later = state.toolCallObservations.filter(item => item.digest === digest && item.seq > error.seq);
    }
    let recoveredFact: ToolResultObservation | null = null;
    for (const candidate of later) {
      if (candidate.callId === null || candidate.callId === error.callId) continue;
      const candidateResult = state.toolResultObservations.find(
        item => item.callId === candidate.callId && item.isError === false,
      );
      if (candidateResult) {
        recoveredFact = candidateResult;
        break;
      }
    }
    const refs = [refOf(state.sessionId, error.seq)];
    if (call) refs.push(refOf(state.sessionId, call.seq));
    if (recoveredFact) refs.push(refOf(state.sessionId, recoveredFact.seq));
    const recovered = recoveredFact !== null;
    const recoveryMs = recoveredFact ? recoveredFact.timeMs - error.timeMs : null;
    results.push({
      metricId: 'tool.error_recovery', contractVersion: '1', subjectId: error.callId,
      status: recovered || state.sealed ? 'available' : 'partial',
      value: { recovered, retryCalls: later.length, ...(recoveryMs !== null ? { recoveryMs } : {}) },
      sampleCount: 1, denominator: 1,
      evidenceRefs: uniqueRefs(refs),
      qualityRefs: recovered ? [] : ['tool_error_unrecovered'],
      evidenceLevel: 'inferred',
    });
  }
  return results;
}

function repeatOverheadResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const byDigest = new Map<string, ToolCallObservation[]>();
  for (const call of state.toolCallObservations) {
    if (call.digest === null) continue;
    const group = byDigest.get(call.digest) ?? [];
    group.push(call);
    byDigest.set(call.digest, group);
  }
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  const results: TrajectoryMetricResult[] = [];
  for (const [digest, calls] of byDigest) {
    if (calls.length < 2) continue;
    const ordered = [...calls].sort((a, b) => a.seq - b.seq);
    let overheadMs = 0;
    let measured = 0;
    const refs: CanonicalEventRef[] = [];
    for (const call of ordered.slice(1)) {
      const closed = call.callId !== null ? closedToolSpan(firstCalls, firstResults, call.callId) : null;
      if (closed && call.callId !== null) {
        const spanStart = firstCalls.get(call.callId)!;
        overheadMs += closed.endMs - spanStart.timeMs;
        measured += 1;
        refs.push(refOf(state.sessionId, spanStart.seq), refOf(state.sessionId, closed.endSeq));
      }
    }
    for (const call of ordered) refs.push(refOf(state.sessionId, call.seq));
    results.push({
      metricId: 'tool.repeat_overhead', contractVersion: '1', subjectId: digest,
      status: measured ? 'available' : 'partial',
      value: { repeatCalls: ordered.length - 1, overheadMs },
      sampleCount: ordered.length, denominator: ordered.length,
      evidenceRefs: uniqueRefs(refs),
      qualityRefs: measured < ordered.length - 1 ? ['repeat_call_unmeasured'] : [],
      evidenceLevel: 'inferred',
    });
  }
  return results;
}

function todoSnapshotChangeResult(state: MetricFoldState): TrajectoryMetricResult {
  const snapshots = state.todoSnapshots;
  let structural = 0;
  let statusChanges = 0;
  let previous: Map<string, string> | null = null;
  for (const snapshot of snapshots) {
    const current = new Map<string, string>();
    for (const item of snapshot.items) current.set(item.digest, item.status);
    if (previous !== null) {
      const sameSet = previous.size === current.size && [...previous.keys()].every(key => current.has(key));
      if (!sameSet) structural += 1;
      else if ([...previous.keys()].some(key => previous!.get(key) !== current.get(key))) statusChanges += 1;
    }
    previous = current;
  }
  return {
    metricId: 'planning.todo_snapshot_change', contractVersion: '1', subjectId: state.sessionId,
    status: snapshots.length ? 'available' : 'unavailable',
    ...(snapshots.length ? {
      value: {
        snapshotCount: snapshots.length,
        structuralChanges: structural,
        statusChanges,
        goalRevisions: state.goalChangeRefs.length,
      },
    } : {}),
    sampleCount: snapshots.length, denominator: snapshots.length,
    evidenceRefs: lastRefs([...snapshots.map(item => item.ref), ...state.goalChangeRefs]),
    qualityRefs: [], evidenceLevel: 'derived',
  };
}

function rewriteAfterCompletionResult(state: MetricFoldState): TrajectoryMetricResult {
  const snapshots = state.todoSnapshots;
  const rewrites: CanonicalEventRef[] = [];
  let previous: Map<string, string> | null = null;
  let previousAllCompleted = false;
  for (const snapshot of snapshots) {
    const current = new Map<string, string>();
    for (const item of snapshot.items) current.set(item.digest, item.status);
    if (previous !== null && previousAllCompleted && previous.size > 0) {
      const sameSet = previous.size === current.size && [...previous.keys()].every(key => current.has(key));
      if (!sameSet) rewrites.push(snapshot.ref);
    }
    previous = current;
    previousAllCompleted = previous.size > 0 && [...previous.values()].every(status => status === 'completed');
  }
  return {
    metricId: 'planning.rewrite_after_completion', contractVersion: '1', subjectId: state.sessionId,
    status: snapshots.length ? 'available' : 'unavailable',
    ...(snapshots.length ? { value: { rewriteCount: rewrites.length } } : {}),
    sampleCount: rewrites.length, denominator: Math.max(snapshots.length - 1, 0),
    evidenceRefs: lastRefs(rewrites), qualityRefs: [], evidenceLevel: 'derived',
  };
}

function inboxWaitIntervals(state: MetricFoldState): Array<{ messageId: string; startMs: number; endMs: number; refs: CanonicalEventRef[] }> {
  const waits: Array<{ messageId: string; startMs: number; endMs: number; refs: CanonicalEventRef[] }> = [];
  for (const insert of state.inboxInserts) {
    for (const messageId of insert.messageIds) {
      const candidates = state.surfacedMessages.filter(
        item => item.messageId === messageId && item.seq >= insert.seq,
      ).sort((a, b) => a.seq - b.seq);
      const match = candidates[0];
      if (match) {
        waits.push({ messageId, startMs: insert.timeMs, endMs: match.timeMs, refs: [insert.ref, match.ref] });
      }
    }
  }
  return waits;
}

function inboxInsertResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const results: TrajectoryMetricResult[] = [];
  const waits = inboxWaitIntervals(state);
  const paired = new Set(waits.map(wait => wait.messageId));
  for (const wait of waits) {
    results.push({
      metricId: 'coordination.inbox_insert_to_message_event_ms', contractVersion: '1', subjectId: wait.messageId,
      status: 'available', value: wait.endMs - wait.startMs, unit: 'ms', sampleCount: 1, denominator: 1,
      evidenceRefs: sortRefs(wait.refs), qualityRefs: [], evidenceLevel: 'derived',
    });
  }
  const unpairedIds = new Set<string>();
  const unpairedRefs: CanonicalEventRef[] = [];
  for (const insert of state.inboxInserts) {
    for (const messageId of insert.messageIds) {
      if (!paired.has(messageId)) {
        unpairedIds.add(messageId);
        unpairedRefs.push(insert.ref);
      }
    }
  }
  for (const messageId of [...unpairedIds].sort()) {
    results.push({
      metricId: 'coordination.inbox_insert_to_message_event_ms', contractVersion: '1', subjectId: messageId,
      status: state.sealed ? 'incomplete' : 'partial', unit: 'ms', sampleCount: 0, denominator: 1,
      evidenceRefs: lastRefs(unpairedRefs), qualityRefs: ['inbox_message_unsurfaced'], evidenceLevel: 'derived',
    });
  }
  return results;
}

function inboxToolOverlapResult(state: MetricFoldState): TrajectoryMetricResult {
  const waits = inboxWaitIntervals(state);
  if (!waits.length) {
    return {
      metricId: 'coordination.inbox_tool_overlap_share', contractVersion: '1', subjectId: state.sessionId,
      status: 'unavailable', unit: 'share', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  const windowEnd = Math.max(...waits.map(wait => wait.endMs));
  const totalWait = waits.reduce((sum, wait) => sum + (wait.endMs - wait.startMs), 0);
  const intervals = toolIntervalList(state, windowEnd);
  const overlap = waits.reduce((sum, wait) => sum + overlapMeasure(intervals, [wait.startMs, wait.endMs]), 0);
  return {
    metricId: 'coordination.inbox_tool_overlap_share', contractVersion: '1', subjectId: state.sessionId,
    status: 'available', ...(totalWait > 0 ? { value: overlap / totalWait } : {}), unit: 'share',
    sampleCount: waits.length, denominator: totalWait,
    evidenceRefs: uniqueRefs(waits.flatMap(wait => wait.refs)), evidenceLevel: 'inferred',
    qualityRefs: totalWait > 0 ? [] : ['inbox_wait_zero_width'],
  };
}

function teamDeliveryResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const queued = new Map<string, { timeMs: number; ref: CanonicalEventRef }>();
  for (const item of state.queuedTeamMessages) {
    if (item.messageId !== null) queued.set(item.messageId, { timeMs: item.timeMs, ref: item.ref });
  }
  const delivered = new Map<string, { timeMs: number; ref: CanonicalEventRef }>();
  for (const item of state.deliveredTeamMessages) {
    if (item.messageId !== null) delivered.set(item.messageId, { timeMs: item.timeMs, ref: item.ref });
  }
  const results: TrajectoryMetricResult[] = [];
  for (const messageId of [...new Set([...queued.keys(), ...delivered.keys()])].sort()) {
    const start = queued.get(messageId);
    const end = delivered.get(messageId);
    if (start && end) {
      if (end.timeMs >= start.timeMs) {
        results.push({
          metricId: 'coordination.team_delivery_ms', contractVersion: '1', subjectId: messageId,
          status: 'available', value: end.timeMs - start.timeMs, unit: 'ms', sampleCount: 1, denominator: 1,
          evidenceRefs: sortRefs([start.ref, end.ref]), qualityRefs: [], evidenceLevel: 'derived',
        });
      } else {
        results.push({
          metricId: 'coordination.team_delivery_ms', contractVersion: '1', subjectId: messageId,
          status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: 1,
          evidenceRefs: sortRefs([start.ref, end.ref]), qualityRefs: ['team_delivery_end_precedes_start'], evidenceLevel: 'derived',
        });
      }
    } else if (start) {
      results.push({
        metricId: 'coordination.team_delivery_ms', contractVersion: '1', subjectId: messageId,
        status: state.sealed ? 'incomplete' : 'partial', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [start.ref], qualityRefs: ['team_message_undelivered'], evidenceLevel: 'derived',
      });
    }
  }
  return results;
}

function delegationDepthResult(state: MetricFoldState): TrajectoryMetricResult {
  return {
    metricId: 'coordination.delegation_depth', contractVersion: '1', subjectId: state.sessionId,
    status: 'available',
    value: state.eventCount > 0 ? (state.delegationDepth ?? 0) : 0,
    sampleCount: 1, denominator: 1,
    evidenceRefs: state.eventCount > 0 && state.lastEventRef ? [state.lastEventRef] : [],
    qualityRefs: [], evidenceLevel: 'observed',
  };
}

function fanOutWidthResult(state: MetricFoldState): TrajectoryMetricResult {
  const members = [...new Set(state.teamMemberIds)].sort();
  if (!members.length && !state.subagentChildren.length) {
    return {
      metricId: 'coordination.fan_out_width', contractVersion: '1', subjectId: state.sessionId,
      status: 'unavailable', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  return {
    metricId: 'coordination.fan_out_width', contractVersion: '1', subjectId: state.sessionId,
    status: 'available', value: members.length, sampleCount: members.length, denominator: members.length,
    evidenceRefs: lastRefs(state.teamMemberSnapshotRefs), qualityRefs: [], evidenceLevel: 'derived',
  };
}

function memberIdleResult(state: MetricFoldState): TrajectoryMetricResult | null {
  const members = [...new Set(state.teamMemberIds)];
  if (!members.length) return null;
  return {
    metricId: 'coordination.member_idle_ms', contractVersion: '1', subjectId: state.sessionId,
    status: 'unavailable', unit: 'ms', sampleCount: members.length, denominator: members.length,
    evidenceRefs: [], qualityRefs: ['member_liveness_unsupported'], evidenceLevel: 'derived',
  };
}

function taskBlockedResults(state: MetricFoldState): TrajectoryMetricResult[] {
  const byTask = new Map<string, TaskSnapshotObservation[]>();
  for (const snapshot of state.taskSnapshots) {
    if (snapshot.taskId === null) continue;
    const list = byTask.get(snapshot.taskId) ?? [];
    list.push(snapshot);
    byTask.set(snapshot.taskId, list);
  }
  const results: TrajectoryMetricResult[] = [];
  for (const [taskId, snapshots] of byTask) {
    const ordered = [...snapshots].sort((a, b) => a.ref.seq - b.ref.seq);
    let blockedSince: number | null = null;
    let duration: number | null = null;
    for (const snapshot of ordered) {
      const hasBlockers = Array.isArray(snapshot.blockedBy) && snapshot.blockedBy.length > 0;
      if (blockedSince === null && hasBlockers && snapshot.status === 'pending') {
        blockedSince = snapshot.timeMs;
      } else if (blockedSince !== null && (!hasBlockers || snapshot.status !== 'pending')) {
        duration = snapshot.timeMs - blockedSince;
        break;
      }
    }
    if (blockedSince === null) {
      results.push({
        metricId: 'coordination.task_blocked_duration', contractVersion: '1', subjectId: taskId,
        status: 'unavailable', unit: 'ms', sampleCount: 0, denominator: ordered.length,
        evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
      });
    } else if (duration !== null) {
      results.push({
        metricId: 'coordination.task_blocked_duration', contractVersion: '1', subjectId: taskId,
        status: 'available', value: duration, unit: 'ms', sampleCount: 1, denominator: ordered.length,
        evidenceRefs: lastRefs(ordered.map(snapshot => snapshot.ref)), qualityRefs: [], evidenceLevel: 'derived',
      });
    } else {
      results.push({
        metricId: 'coordination.task_blocked_duration', contractVersion: '1', subjectId: taskId,
        status: state.sealed ? 'incomplete' : 'partial', unit: 'ms', sampleCount: 0, denominator: ordered.length,
        evidenceRefs: [ordered[ordered.length - 1]!.ref], qualityRefs: ['task_still_blocked'], evidenceLevel: 'derived',
      });
    }
  }
  return results;
}

function teamPathCriticalSegmentsResult(state: MetricFoldState): TrajectoryMetricResult | null {
  const memberEvidence = state.teamMemberIds.length > 0;
  const taskIds = new Set(
    state.taskSnapshots.map(snapshot => snapshot.taskId).filter((id): id is string => id !== null),
  );
  const edges = new Map<string, string[]>();
  const edgeRefs: CanonicalEventRef[] = [];
  for (const snapshot of state.taskSnapshots) {
    if (snapshot.taskId === null || snapshot.blockedBy === null) continue;
    for (const blockedId of snapshot.blockedBy) {
      if (!taskIds.has(blockedId)) continue;
      const list = edges.get(snapshot.taskId) ?? [];
      list.push(blockedId);
      edges.set(snapshot.taskId, list);
      edgeRefs.push(snapshot.ref);
    }
  }
  if (!memberEvidence && edges.size === 0) return null;
  const latestStatus = new Map<string, string | null>();
  const byTask = new Map<string, TaskSnapshotObservation[]>();
  for (const snapshot of state.taskSnapshots) {
    if (snapshot.taskId === null) continue;
    latestStatus.set(snapshot.taskId, snapshot.status);
    const list = byTask.get(snapshot.taskId) ?? [];
    list.push(snapshot);
    byTask.set(snapshot.taskId, list);
  }
  const taskSpanMs = new Map<string, number>();
  for (const [taskId, snapshots] of byTask) {
    const ordered = [...snapshots].sort((a, b) => a.ref.seq - b.ref.seq);
    const started = ordered.find(snapshot => snapshot.status === 'in_progress');
    if (!started) {
      taskSpanMs.set(taskId, 0);
      continue;
    }
    const ended = ordered.find(
      snapshot => snapshot.status === 'completed' && snapshot.ref.seq > started.ref.seq,
    );
    taskSpanMs.set(taskId, ended ? ended.timeMs - started.timeMs : 0);
  }
  const longestFrom = (taskId: string, seen: Set<string>): { chain: string[]; weight: number } => {
    if (seen.has(taskId)) return { chain: [taskId], weight: 0 };
    let bestChain: string[] = [];
    let bestWeight = -1;
    for (const blockedId of [...(edges.get(taskId) ?? [])].sort()) {
      const sub = longestFrom(blockedId, new Set([...seen, taskId]));
      if (sub.weight > bestWeight) {
        bestChain = sub.chain;
        bestWeight = sub.weight;
      }
    }
    return { chain: [taskId, ...bestChain], weight: (taskSpanMs.get(taskId) ?? 0) + Math.max(bestWeight, 0) };
  };
  const chains = [...edges.keys()].sort().map(taskId => longestFrom(taskId, new Set()));
  const critical = chains.reduce(
    (best, item) => (item.weight > best.weight ? item : best),
    { chain: [] as string[], weight: 0 },
  );
  const pendingWithBlockers = [...latestStatus.entries()]
    .filter(([taskId, status]) => status === 'pending' && (edges.get(taskId)?.length ?? 0) > 0)
    .map(([taskId]) => taskId)
    .sort();
  return {
    metricId: 'coordination.team_path_critical_segments', contractVersion: '1', subjectId: state.sessionId,
    status: pendingWithBlockers.length ? 'partial' : 'available',
    ...(critical.chain.length ? { value: { segments: critical.chain, observedDurationMs: critical.weight } } : {}),
    sampleCount: edgeRefs.length, denominator: edgeRefs.length,
    evidenceRefs: lastRefs(edgeRefs),
    qualityRefs: pendingWithBlockers.length ? ['dependency_graph_incomplete'] : [],
    evidenceLevel: 'derived',
  };
}

function turnReasonMixResult(state: MetricFoldState): TrajectoryMetricResult {
  const ends = state.turnEndReasons;
  const mix = new Map<string, number>();
  let unknown = 0;
  for (const end of ends) {
    if (end.reasonKind) mix.set(end.reasonKind, (mix.get(end.reasonKind) ?? 0) + 1);
    else unknown += 1;
  }
  const openTurns = state.turnIntervals.filter(interval =>
    interval.firstEndMs === null || interval.firstEndMs < interval.startMs,
  );
  const quality = new Set<string>();
  if (unknown) quality.add('turn_reason_missing');
  if (openTurns.length) quality.add('turn_open');
  const value: Record<string, number> = {};
  for (const key of [...mix.keys()].sort()) value[key] = mix.get(key)!;
  return {
    metricId: 'outcome.turn_reason_mix', contractVersion: '1', subjectId: state.sessionId,
    status: ends.length ? (openTurns.length || unknown ? 'partial' : 'available') : 'unavailable',
    ...(ends.length ? { value } : {}),
    sampleCount: ends.length, denominator: ends.length,
    evidenceRefs: lastRefs(ends.map(end => end.ref)),
    qualityRefs: [...quality].sort(), evidenceLevel: 'derived',
  };
}

function turnCompletionEvidenceResult(state: MetricFoldState): TrajectoryMetricResult {
  const ends = state.turnEndReasons;
  const mix = new Map<string, number>();
  let unknown = 0;
  for (const end of ends) {
    if (end.reasonKind) mix.set(end.reasonKind, (mix.get(end.reasonKind) ?? 0) + 1);
    else unknown += 1;
  }
  const deliverableTurns = new Set<number>();
  let deliverableCount = 0;
  for (const deliverable of state.deliverableTurns) {
    if (deliverable.turn !== null) deliverableTurns.add(deliverable.turn);
    if (deliverable.fileCount !== null) deliverableCount += deliverable.fileCount;
  }
  const value: Record<string, number> = { turns: ends.length };
  for (const key of [...mix.keys()].sort()) {
    const total = mix.get(key)!;
    if (total > 0) value[key] = total;
  }
  value.turnsWithDeliverables = deliverableTurns.size;
  value.deliverableCount = deliverableCount;
  return {
    metricId: 'outcome.turn_completion_evidence', contractVersion: '1', subjectId: state.sessionId,
    status: ends.length ? (unknown ? 'partial' : 'available') : 'unavailable',
    ...(ends.length ? { value } : {}),
    sampleCount: ends.length, denominator: ends.length,
    evidenceRefs: lastRefs([
      ...ends.map(end => end.ref),
      ...state.deliverableTurns.map(deliverable => deliverable.ref),
    ]),
    qualityRefs: unknown ? ['turn_reason_missing'] : [], evidenceLevel: 'derived',
  };
}

function trajectoryCoverageResult(state: MetricFoldState): TrajectoryMetricResult {
  return trajectoryCoverageFrom(state, state.qualityItems);
}

/** Coverage for a session over an explicit quality-item list (tree codes included). */
function trajectoryCoverageFrom(state: MetricFoldState, qualityItems: QualityItem[]): TrajectoryMetricResult {
  const unknownTypes = qualityItems.filter(item => item.code === 'unknown_event_type').length;
  const callIds = new Set(
    state.toolCallObservations.map(call => call.callId).filter((id): id is string => id !== null),
  );
  const unpaired = state.toolResultObservations.filter(
    result => result.callId === null || !callIds.has(result.callId),
  );
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  const openToolCalls = [...firstCalls.keys()].filter(callId => closedToolSpan(firstCalls, firstResults, callId) === null).length;
  const openCompactions = Object.keys(state.compactionStartsById).length - closedCompactionIds(state).length;
  const openApprovals = Object.keys(state.approvalAsks).filter(requestId => {
    const ask = state.approvalAsks[requestId]!;
    const end = state.approvalEnds[requestId];
    return end === undefined || end.decidedMs < ask.askMs;
  }).length;
  const openTurns = state.turnIntervals.filter(interval =>
    interval.firstEndMs === null || interval.firstEndMs < interval.startMs,
  ).length;
  const openSpans = openToolCalls + openCompactions + openTurns + openApprovals;
  const codes = new Set(qualityItems.map(item => item.code));
  const refs: CanonicalEventRef[] = [
    ...qualityItems.flatMap(item => item.refs),
    ...unpaired.map(result => refOf(state.sessionId, result.seq)),
  ];
  return {
    metricId: 'data_quality.trajectory_coverage', contractVersion: '1', subjectId: state.sessionId,
    status: 'available',
    value: {
      unknownEventTypes: unknownTypes,
      unpairedToolResults: unpaired.length,
      openSpans,
      qualityIssueCount: qualityItems.length,
      qualityCodes: [...codes].sort(),
    },
    sampleCount: state.eventCount, denominator: state.eventCount,
    evidenceRefs: lastRefs(refs), qualityRefs: [], evidenceLevel: 'derived',
  };
}

/** Exposed for the team engine's root-coverage override. */
export function trajectoryCoverageWithQuality(state: MetricFoldState, qualityItems: QualityItem[]): TrajectoryMetricResult {
  return trajectoryCoverageFrom(state, qualityItems);
}

/** Coverage-building inputs, shared by the per-session fold and the team engine. */
export interface CoverageInputs {
  unknownEventTypes: number;
  unpairedToolResultRefs: CanonicalEventRef[];
  openSpans: number;
}

export function coverageInputs(state: MetricFoldState): CoverageInputs {
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  const openToolCalls = [...firstCalls.keys()].filter(callId => closedToolSpan(firstCalls, firstResults, callId) === null).length;
  const openCompactions = Object.keys(state.compactionStartsById).length - closedCompactionIds(state).length;
  const openApprovals = Object.keys(state.approvalAsks).filter(requestId => {
    const ask = state.approvalAsks[requestId]!;
    const end = state.approvalEnds[requestId];
    return end === undefined || end.decidedMs < ask.askMs;
  }).length;
  const openTurns = state.turnIntervals.filter(interval =>
    interval.firstEndMs === null || interval.firstEndMs < interval.startMs,
  ).length;
  const callIds = new Set(
    state.toolCallObservations.map(call => call.callId).filter((id): id is string => id !== null),
  );
  return {
    unknownEventTypes: Object.keys(state.unknownEventTypes).length,
    unpairedToolResultRefs: state.toolResultObservations
      .filter(result => result.callId === null || !callIds.has(result.callId))
      .map(result => refOf(state.sessionId, result.seq)),
    openSpans: openToolCalls + openCompactions + openTurns + openApprovals,
  };
}

/**
 * Rebuild quality items that aeval derives from the final session state:
 * precedes-start anomalies, orphan turn ends, and unobserved blocked-by
 * targets. Event-time items are kept as-is.
 */
function rebuildDerivedQuality(state: MetricFoldState): MetricFoldState {
  const kept = state.qualityItems.filter(item => !DERIVED_QUALITY_CODES.has(item.code));
  const derived: QualityItem[] = [];
  const firstCalls = firstCallByCallId(state);
  const firstResults = firstResultByCallId(state);
  for (const [callId, call] of firstCalls) {
    const result = firstResults.get(callId);
    if (result && result.timeMs < call.timeMs) {
      derived.push({ code: 'tool_result_precedes_call', refs: [refOf(state.sessionId, call.seq)] });
    }
  }
  for (const [compactionId, start] of Object.entries(state.compactionStartsById)) {
    const end = state.compactionEndsById[compactionId];
    if (end && end.timeMs < start.timeMs) {
      derived.push({ code: 'compaction_end_precedes_start', refs: [refOf(state.sessionId, start.seq)] });
    }
  }
  for (const [requestId, ask] of Object.entries(state.approvalAsks)) {
    const end = state.approvalEnds[requestId];
    if (end && end.decidedMs < ask.askMs) {
      derived.push({ code: 'approval_end_precedes_start', refs: [refOf(state.sessionId, ask.askSeq)] });
    }
  }
  for (const interval of state.turnIntervals) {
    if (interval.firstEndMs !== null && interval.firstEndMs < interval.startMs) {
      derived.push({ code: 'turn_end_precedes_start', refs: [refOf(state.sessionId, interval.startSeq)] });
    }
  }
  for (const [turn, ref] of Object.entries(state.orphanTurnEndRefs)) {
    derived.push({ code: 'turn_end_without_start', refs: [ref] });
    void turn;
  }
  const taskIds = new Set(
    state.taskSnapshots.map(snapshot => snapshot.taskId).filter((id): id is string => id !== null),
  );
  for (const snapshot of state.taskSnapshots) {
    if (snapshot.taskId === null || snapshot.blockedBy === null) continue;
    for (const blockedId of snapshot.blockedBy) {
      if (!taskIds.has(blockedId)) {
        derived.push({ code: 'blocked_by_task_not_observed', refs: [snapshot.ref] });
      }
    }
  }
  return { ...state, qualityItems: [...kept, ...derived] };
}

/** Recompute every per-session result from the current state. */
function recomputeSessionResults(state: MetricFoldState): MetricFoldState {
  const withQuality = rebuildDerivedQuality(state);
  let next = withQuality;
  for (const result of [
    summaryCyclesResult(withQuality),
    compactionFrequencyResult(withQuality),
    compactionShadowedTokensResult(withQuality),
    compactionPrunePassesResult(withQuality),
    toolFailureRateResult(withQuality),
    compactionTimeShareResult(withQuality),
    longGapResult(withQuality),
    repeatLoopResult(withQuality),
    todoSnapshotChangeResult(withQuality),
    rewriteAfterCompletionResult(withQuality),
    inboxToolOverlapResult(withQuality),
    delegationDepthResult(withQuality),
    turnReasonMixResult(withQuality),
    turnCompletionEvidenceResult(withQuality),
    trajectoryCoverageResult(withQuality),
    fanOutWidthResult(withQuality),
    memberIdleResult(withQuality),
    teamPathCriticalSegmentsResult(withQuality),
  ]) {
    if (result) next = upsertResult(next, result);
  }
  for (const result of [
    ...compactionElapsedResults(withQuality),
    ...toolCallElapsedResults(withQuality),
    ...stepToFirstChunkResults(withQuality),
    ...streamSpanResults(withQuality),
    ...reclaimedTokensResults(withQuality),
    ...inputWindowUtilizationResults(withQuality),
    ...retryRecoveryResults(withQuality),
    ...errorRecoveryResults(withQuality),
    ...repeatOverheadResults(withQuality),
    ...inboxInsertResults(withQuality),
    ...teamDeliveryResults(withQuality),
    ...taskBlockedResults(withQuality),
  ]) {
    next = upsertResult(next, result);
  }
  return next;
}

/** Metric families whose status flips once the session's completion flag is known. */
const COMPLETION_SENSITIVE_METRICS = new Set<TrajectoryMetricId>([
  'model.step_to_first_chunk_ms',
  'model.retry_recovery',
  'tool.error_recovery',
  'coordination.inbox_insert_to_message_event_ms',
  'coordination.team_delivery_ms',
  'coordination.task_blocked_duration',
]);

/**
 * Apply the session's completion flag to the completion-sensitive results.
 *
 * The live fold never seals (a running session stays ``partial`` for
 * unrecovered evidence); the parity harness and any sealed replay call this
 * once with the fixture's ``complete`` flag so statuses match aeval's offline
 * reducers.
 */
export function sealMetricFoldState(state: MetricFoldState, sealed: boolean): MetricFoldState {
  if (state.sealed === sealed) return state;
  const cleared: MetricFoldState = {
    ...state,
    sealed,
    recentMetricResults: state.recentMetricResults.filter(item =>
      !COMPLETION_SENSITIVE_METRICS.has(item.metricId)),
  };
  return recomputeSessionResults(cleared);
}

function addQuality(state: MetricFoldState, code: string, refs: CanonicalEventRef[]): MetricFoldState {
  return { ...state, qualityItems: [...state.qualityItems, { code, refs }] };
}

/** Record one canonical fact: an event may produce several. */
function markFact(state: MetricFoldState, timeMs: number, ref: CanonicalEventRef, times = 1): MetricFoldState {
  const factTimes = [...state.factTimes];
  const factRefs = [...state.factRefs];
  for (let index = 0; index < times; index += 1) {
    factTimes.push(timeMs);
    factRefs.push(ref);
  }
  return { ...state, factTimes, factRefs };
}

/** Incrementally fold the same lifecycle boundaries consumed by aeval v1 reducers. */
export function foldLifecycleMetrics(
  previous: MetricFoldState,
  event: SessionEvent,
): MetricFoldState {
  const sessionId = previous.sessionId;
  const ref = { sessionId, seq: event.seq };
  let state: MetricFoldState = {
    ...previous,
    eventCount: previous.eventCount + 1,
    firstEventTimeMs: previous.firstEventTimeMs ?? event.time,
    lastEventTimeMs: event.time,
    lastEventRef: ref,
  };
  if (!OFFICIAL_EVENT_TYPES.has(event.type) && !state.unknownEventTypes[event.type]) {
    state = {
      ...state,
      unknownEventTypes: { ...state.unknownEventTypes, [event.type]: ref },
    };
    state = addQuality(state, 'unknown_event_type', [ref]);
  }

  const type = event.type as string;
  const data = (event as { data?: unknown }).data as Record<string, unknown> | undefined;

  if (type === 'step/start' || type === 'step/end') {
    const turn = count(data?.turn);
    const step = count(data?.step);
    if (turn !== null && step !== null) {
      const key = stepKey(turn, step);
      if (type === 'step/start') {
        if (!state.stepStarts[key]) {
          state = { ...state, stepStarts: { ...state.stepStarts, [key]: { timeMs: event.time, seq: event.seq } } };
        }
      } else {
        state = { ...state, stepEnded: { ...state.stepEnded, [key]: true } };
      }
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'turn/start' || type === 'turn/end') {
    const turn = count(data?.turn);
    if (type === 'turn/start') {
      if (turn !== null) {
        const existing = state.turnIntervals.find(item => item.turn === turn);
        if (existing) {
          state = addQuality(state, 'turn_boundary_duplicate', [ref]);
        } else {
          state = {
            ...state,
            turnIntervals: [...state.turnIntervals, {
              turn, startMs: event.time, startSeq: event.seq, firstEndMs: null, firstEndSeq: null,
            }],
          };
        }
      }
    } else {
      const reason = data?.reason && typeof data.reason === 'object' ? data.reason as Record<string, unknown> : {};
      state = { ...state, turnEndReasons: [...state.turnEndReasons, { reasonKind: text(reason.kind), ref }] };
      if (turn !== null) {
        const existing = state.turnIntervals.find(item => item.turn === turn);
        if (existing) {
          if (existing.firstEndMs === null) {
            state = {
              ...state,
              turnIntervals: state.turnIntervals.map(item =>
                item === existing ? { ...item, firstEndMs: event.time, firstEndSeq: event.seq } : item,
              ),
            };
          } else {
            state = addQuality(state, 'turn_boundary_duplicate', [ref]);
          }
        } else {
          state = { ...state, orphanTurnEndRefs: { ...state.orphanTurnEndRefs, [turn]: ref } };
          state = addQuality(state, 'turn_boundary_duplicate', [ref]);
        }
      }
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'assistant/message' || type === 'assistant/attempt') {
    const turn = count(data?.turn);
    const step = count(data?.step);
    const key = turn !== null && step !== null ? stepKey(turn, step) : null;
    const firstTokenTime = assistantStreamFirstTokenTime((data?.stream ?? []) as never);
    let factCount = 0;
    if (firstTokenTime !== undefined) {
      factCount += 1;
      if (key !== null) {
        state = {
          ...state,
          stepTokens: {
            ...state.stepTokens,
            [key]: [...(state.stepTokens[key] ?? []), { timeMs: firstTokenTime, seq: event.seq }],
          },
        };
      }
    }
    if (type === 'assistant/message') {
      factCount += 1;
      const bounds = streamTimeBounds(data?.stream);
      if (bounds) {
        state = {
          ...state,
          streamSpans: [...state.streamSpans, {
            key: `${spanKeyPart(data?.turn)}:${spanKeyPart(data?.step)}`,
            startMs: bounds.startMs, endMs: bounds.endMs, ref,
          }],
        };
      }
      const usage = data?.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
      const inputTokens = count(usage.inputTokens);
      state = {
        ...state,
        modelUsageInputTokens: state.modelUsageInputTokens + (inputTokens ?? 0),
        modelUsageMissingCount: state.modelUsageMissingCount + (inputTokens === null ? 1 : 0),
        modelUsageRefs: [...state.modelUsageRefs, ref].slice(-64),
        modelUsageObservations: [...state.modelUsageObservations, {
          turn, step, inputTokens, timeMs: event.time, seq: event.seq, ref,
        }],
      };
    }
    return recomputeSessionResults(markFact(state, event.time, ref, factCount));
  }

  if (type === 'request/header') {
    const header = data?.header && typeof data.header === 'object' ? data.header as Record<string, unknown> : {};
    const config = header.config && typeof header.config === 'object' ? header.config as Record<string, unknown> : {};
    state = {
      ...state,
      routeObservations: [...state.routeObservations, {
        provider: text(config.provider), model: text(config.model), seq: event.seq, ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'request/context') {
    state = {
      ...state,
      contextWindowObservations: [...state.contextWindowObservations, {
        provider: text(data?.provider), model: text(data?.model),
        contextWindow: count(data?.contextWindow), seq: event.seq, ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'tool/call') {
    const callId = text(data?.callId);
    const digest = toolCallDigest(data?.name, data?.arguments);
    const previousCalls = state.toolCallObservations;
    state = {
      ...state,
      toolCallObservations: [...previousCalls, { callId, digest, timeMs: event.time, seq: event.seq }],
    };
    if (callId !== null) {
      const firstCall = previousCalls.find(item => item.callId === callId);
      if (firstCall) {
        state = addQuality(state, 'tool_call_id_duplicate', [refOf(sessionId, firstCall.seq), ref]);
      }
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'tool/result') {
    if (isToolResultSurfaceReplacement(event)) return state;
    const message = data?.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {};
    const source = message.source && typeof message.source === 'object' ? message.source as Record<string, unknown> : {};
    const callId = text(source.callId) ?? text(message.toolCallId);
    const isError = typeof message.isError === 'boolean' ? message.isError : null;
    state = {
      ...state,
      toolResultObservations: [...state.toolResultObservations, { callId, isError, timeMs: event.time, seq: event.seq }],
      toolResultRefs: [...state.toolResultRefs, ref].slice(-64),
    };
    if (callId !== null) {
      if (state.duplicateToolResultIds[callId]) {
        // Keep the original diagnostic state and its evidence ring.
      } else if (Object.hasOwn(state.toolResultByCallId, callId)) {
        const firstResult = state.toolResultObservations.find(item => item.callId === callId)!;
        state = {
          ...state,
          duplicateToolResultIds: { ...state.duplicateToolResultIds, [callId]: true },
        };
        state = addQuality(state, 'tool_result_duplicate', [refOf(sessionId, firstResult.seq), ref]);
      } else {
        state = {
          ...state,
          toolResultByCallId: { ...state.toolResultByCallId, [callId]: isError },
        };
      }
    } else {
      state = { ...state, toolResultMissingIdCount: state.toolResultMissingIdCount + 1 };
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'deliverables/presented') {
    const files = Array.isArray(data?.files) ? data!.files as unknown[] : null;
    state = {
      ...state,
      deliverableTurns: [...state.deliverableTurns, {
        turn: count(data?.turn),
        fileCount: files ? files.length : null,
        ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'todo/write') {
    const todos = Array.isArray(data?.todos) ? data!.todos as unknown[] : [];
    const items: Array<{ digest: string; status: string }> = [];
    for (const item of todos) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      const digest = todoItemDigest(entry.content);
      const status = entry.status;
      if (digest !== null && typeof status === 'string') items.push({ digest, status });
    }
    state = { ...state, todoSnapshots: [...state.todoSnapshots, { items, ref }] };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'goal/change') {
    state = { ...state, goalChangeRefs: [...state.goalChangeRefs, ref] };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'agent/inbox/spliced') {
    const inserted = Array.isArray(data?.inserted) ? data!.inserted as unknown[] : [];
    const messageIds = inserted
      .map(item => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>).id : undefined))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    state = { ...state, inboxInserts: [...state.inboxInserts, { messageIds, timeMs: event.time, seq: event.seq, ref }] };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'user/message') {
    state = {
      ...state,
      surfacedMessages: [...state.surfacedMessages, {
        messageId: text(data?.id), timeMs: event.time, seq: event.seq, ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'llm/retry' || type === 'llm/retry-started') {
    const retryId = text(data?.retryId);
    if (retryId !== null) {
      const existing = state.retryGroups.find(group => group.retryId === retryId);
      if (existing) {
        state = {
          ...state,
          retryGroups: state.retryGroups.map(group =>
            group === existing
              ? {
                  ...group,
                  lastTimeMs: event.time, lastSeq: event.seq, count: group.count + 1,
                  refs: [...group.refs, ref],
                }
              : group,
          ),
        };
      } else {
        state = {
          ...state,
          retryGroups: [...state.retryGroups, {
            retryId,
            turn: count(data?.turn), step: count(data?.step),
            firstTimeMs: event.time, firstSeq: event.seq,
            lastTimeMs: event.time, lastSeq: event.seq,
            count: 1, refs: [ref],
          }],
        };
      }
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'subagent/catalog') {
    state = {
      ...state,
      subagentChildren: [...state.subagentChildren, {
        childId: text(data?.childId), childCreatedAtMs: count(data?.childCreatedAt), ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'team/member') {
    const member = data?.member && typeof data.member === 'object' ? data.member as Record<string, unknown> : {};
    const memberId = text(member.id);
    if (memberId !== null && !state.teamMemberIds.includes(memberId)) {
      state = { ...state, teamMemberIds: [...state.teamMemberIds, memberId] };
    }
    state = {
      ...state,
      teamMemberSnapshotRefs: [...state.teamMemberSnapshotRefs, ref],
      teamMemberSnapshots: [...state.teamMemberSnapshots, {
        memberId, phase: text(member.phase), timeMs: event.time, ref,
      }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'team/task') {
    const task = data?.task && typeof data.task === 'object' ? data.task as Record<string, unknown> : {};
    const taskId = text(task.id);
    const blockedBy = Array.isArray(task.blockedBy)
      ? task.blockedBy.filter((id): id is string => typeof id === 'string')
      : null;
    state = {
      ...state,
      taskSnapshots: [...state.taskSnapshots, {
        taskId, status: text(task.status), blockedBy,
        timeMs: event.time, ref,
      }],
    };
    if (taskId !== null && blockedBy === null) {
      state = addQuality(state, 'task_blocked_by_missing', [ref]);
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'team/message/queued') {
    const message = data?.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {};
    state = {
      ...state,
      queuedTeamMessages: [...state.queuedTeamMessages, { messageId: text(message.id), timeMs: event.time, ref }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'team/message/delivered') {
    state = {
      ...state,
      deliveredTeamMessages: [...state.deliveredTeamMessages, { messageId: text(data?.messageId), timeMs: event.time, ref }],
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'approval/asked') {
    const requestId = text(data?.id);
    if (requestId !== null && !state.approvalAsks[requestId]) {
      state = {
        ...state,
        approvalAsks: { ...state.approvalAsks, [requestId]: { askMs: event.time, askSeq: event.seq } },
      };
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'approval/decided') {
    const requestId = text(data?.id);
    if (requestId !== null && !state.approvalEnds[requestId]) {
      state = {
        ...state,
        approvalEnds: { ...state.approvalEnds, [requestId]: { decidedMs: event.time, decidedSeq: event.seq } },
      };
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type.startsWith('compaction/')) {
    return foldCompactionEvent(state, event, ref, type, data);
  }

  return state;
}

function foldCompactionEvent(
  state: MetricFoldState,
  event: SessionEvent,
  ref: CanonicalEventRef,
  type: string,
  data: Record<string, unknown> | undefined,
): MetricFoldState {
  const compactionId = text(data?.compactionId);
  if (type === 'compaction/start') {
    if (!compactionId) {
      state = addQuality(state, 'compaction_id_missing', [ref]);
      state = { ...state, compactionStartMissingIdRefs: [...state.compactionStartMissingIdRefs, ref] };
      return recomputeSessionResults(markFact(state, event.time, ref));
    }
    if (state.compactionStartsById[compactionId]) {
      state = addQuality(state, 'compaction_start_duplicate', [
        refOf(state.sessionId, state.compactionStartsById[compactionId]!.seq), ref,
      ]);
      state = {
        ...state,
        compactionStartRefsById: {
          ...state.compactionStartRefsById,
          [compactionId]: [...(state.compactionStartRefsById[compactionId] ?? []), ref],
        },
      };
      return recomputeSessionResults(markFact(state, event.time, ref));
    }
    state = {
      ...state,
      compactionStartsById: { ...state.compactionStartsById, [compactionId]: { timeMs: event.time, seq: event.seq } },
      compactionStartRefsById: { ...state.compactionStartRefsById, [compactionId]: [ref] },
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'compaction/summary') {
    const tokenCount = count(data?.shadowedTokenCount);
    const usage = data?.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
    state = { ...state, compactionSummaryRefs: [...state.compactionSummaryRefs, ref].slice(-64) };
    if (!compactionId) {
      state = { ...state, compactionSummaryMissingIdCount: state.compactionSummaryMissingIdCount + 1 };
      state = addQuality(state, 'compaction_id_missing', [ref]);
    } else {
      state = {
        ...state,
        compactionSummaryEvents: [...state.compactionSummaryEvents, {
          compactionId, shadowed: tokenCount, total: count(usage.totalTokens), ref,
        }],
      };
      if (state.duplicateCompactionSummaryIds[compactionId]) {
        // Keep the original diagnostic state and its evidence ring.
      } else if (Object.hasOwn(state.compactionSummaryById, compactionId)) {
        const { [compactionId]: _previous, ...compactionSummaryById } = state.compactionSummaryById;
        state = {
          ...state,
          compactionSummaryById,
          duplicateCompactionSummaryIds: { ...state.duplicateCompactionSummaryIds, [compactionId]: true },
        };
      } else {
        state = {
          ...state,
          compactionSummaryById: { ...state.compactionSummaryById, [compactionId]: tokenCount },
        };
      }
    }
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  if (type === 'compaction/end') {
    if (!compactionId) {
      state = addQuality(state, 'compaction_id_missing', [ref]);
      return recomputeSessionResults(markFact(state, event.time, ref));
    }
    if (state.compactionEndsById[compactionId]) {
      state = addQuality(state, 'compaction_end_duplicate', [
        refOf(state.sessionId, state.compactionEndsById[compactionId]!.seq), ref,
      ]);
      return recomputeSessionResults(markFact(state, event.time, ref));
    }
    state = {
      ...state,
      compactionEndsById: { ...state.compactionEndsById, [compactionId]: { timeMs: event.time, seq: event.seq } },
    };
    return recomputeSessionResults(markFact(state, event.time, ref));
  }

  // compaction/prune
  state = { ...state, prunePassCount: state.prunePassCount + 1, pruneEventRefs: [...state.pruneEventRefs, ref].slice(-64) };
  return recomputeSessionResults(markFact(state, event.time, ref));
}
