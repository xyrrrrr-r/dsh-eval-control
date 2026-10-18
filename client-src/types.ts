/**
 * Client-side types for the host projections this dashboard reads.
 *
 * These mirror the wire views produced host-side (`src/analytics/projection.ts`,
 * `src/analytics/contextTimeline.ts`) plus the DSH built-ins (`sessionStats`,
 * `contextPressure`, `contextBreakdown`, `tokenUsage`). All fields are optional
 * at the read site: a missing projection must render placeholders, never throw.
 */

/* ---- Our projections ------------------------------------------------- */

export interface MetricResult {
  metricId: string;
  contractVersion: string;
  subjectId: string;
  status: 'available' | 'partial' | 'incomplete' | 'unavailable';
  value?: number | Record<string, unknown>;
  unit?: string;
  sampleCount: number;
  denominator?: number;
  evidenceRefs: Array<{ sessionId: string; seq: number }>;
  qualityRefs: string[];
  evidenceLevel: 'observed' | 'derived' | 'inferred';
}

export interface TrajectoryAnalytics {
  eventsSeen: number;
  turnsStarted: number;
  turnsEnded: number;
  stepsStarted: number;
  stepsEnded: number;
  toolCalls: number;
  toolResults: number;
  toolErrors: number;
  inputTokens: number;
  inputUsageSteps: number;
  retries: number;
  compactionStarts: number;
  compactionSummaries: number;
  compactionEnds: number;
  prunePasses: number;
  compactionShadowedTokens: number;
  pruneShadowedTokens: number;
  compactionElapsedMs: number;
  teamMemberSnapshots: number;
  teamTaskSnapshots: number;
  queuedTeamMessages: number;
  deliveredTeamMessages: number;
  metricResults: MetricResult[];
  teamInput: TeamInput;
  turnTrend: Array<{
    turn: number;
    toolCalls: number;
    toolErrors: number;
    retries: number;
    compactionStarts: number;
    inputTokens: number;
  }>;
  recentEvents: Array<{
    seq: number;
    time: number;
    type: string;
    label?: string;
    callId?: string;
  }>;
}

export interface TeamInput {
  sessionId: string;
  hasEvents: boolean;
  firstEventTimeMs: number | null;
  lastEventRef: { sessionId: string; seq: number } | null;
  eventCount: number;
  factTimeMax: number | null;
  turnIntervals: Array<{
    turn: number;
    startMs: number;
    startSeq: number;
    firstEndMs: number | null;
    firstEndSeq: number | null;
  }>;
  memberIds: string[];
  teamMemberSnapshotRefs: Array<{ sessionId: string; seq: number }>;
  memberLastRefs: Record<string, { sessionId: string; seq: number }>;
  subagentChildren: Array<{
    childId: string | null;
    childCreatedAtMs: number | null;
    ref: { sessionId: string; seq: number };
  }>;
  childLastRefs: Record<string, { sessionId: string; seq: number }>;
  taskSnapshots: Array<{
    taskId: string | null;
    status: string | null;
    blockedBy: string[] | null;
    timeMs: number;
    ref: { sessionId: string; seq: number };
  }>;
  teamMemberSnapshots: Array<{
    memberId: string | null;
    phase: string | null;
    timeMs: number;
    ref: { sessionId: string; seq: number };
  }>;
  qualityItems: Array<{ code: string; refs: Array<{ sessionId: string; seq: number }> }>;
  unpairedToolResultRefs: Array<{ sessionId: string; seq: number }>;
  unknownEventTypes: number;
  openSpans: number;
}

export interface CompactionSnapshot {
  nodeCount: number;
  truncated: boolean;
  nodes: Array<{ seq: number; label: string; tokens: number; preview: string; changed: boolean }>;
}
export interface CompactionDetail {
  trigger: 'manual' | 'unknown'; algorithm: string; summary: string;
  before: CompactionSnapshot; after: CompactionSnapshot | null;
}

export interface ContextTimeline {
  contextWindow: number | null;
  provider: string | null;
  model: string | null;
  surface: {
    totalTokens: number;
    systemPrompt: number;
    conversation: number;
    toolResults: number;
    toolDefinitions: number;
    fileContents: number;
    compactionSummary: number;
    other: number;
  };
  steps: Array<{
    turn: number;
    step: number;
    seq: number;
    timeMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    surfaceTokens: number;
  }>;
  injections: Array<{
    seq: number;
    timeMs: number;
    kind: 'user' | 'assistant' | 'tool-result' | 'system' | 'developer';
    sourceKind: string;
    toolName: string | null;
    tokens: number;
    turn: number | null;
    preview: string;
    textTokens: number;
    toolCallTokens: number;
    fileTokens: number;
    outputTokens: number | null;
    cumulativeTokens: number;
    callId: string | null;
    callTool: string | null;
  }>;
  injectionTotals: { count: number; tokens: number };
  compactions: Array<{
    detail?: CompactionDetail;
    seq: number;
    timeMs: number;
    id: string;
    kind: 'summary' | 'prune';
    beforeTokens: number | null;
    afterTokens: number | null;
    reclaimedTokens: number | null;
    reclaimRatio: number | null;
    elapsedMs: number | null;
    turn: number | null;
  }>;
  compactionTotals: { count: number; reclaimedTokens: number; elapsedMs: number };
  tools: Array<{ name: string; calls: number; errors: number }>;
  segments: Array<{
    segment: 'systemPrompt' | 'conversation' | 'toolDefinitions' | 'toolResults' | 'fileContents' | 'compactionSummary' | 'other';
    tokens: number;
    nodeCount: number;
    nodes: Array<{ seq: number; label: string; tokens: number; preview: string; turn: number | null; callId: string | null; callTool: string | null }>;
  }>;
}

/* ---- DSH built-ins ---------------------------------------------------- */

export interface SessionStats {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeTokens: number;
}

export interface ContextPressure {
  contextWindow?: number;
  pressureTokens?: number;
  projectedTokens?: number;
}

export interface ContextBreakdown {
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
}

export interface TokenUsage {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/* ---- View props (conversation.view slot standard props) --------------- */

export interface ViewProps {
  useProjection?: <T = unknown>(key: string) => T | undefined;
  inspectCall?: (callId: string) => void;
  useSessions?: <T>(selector: (snapshot: unknown) => T) => T;
  sessionId?: string;
}

/* ---- Slot registration context ---------------------------------------- */

export interface SessionsService {
  using?: (target: string, options: { source: string }, operation: (reference: unknown) => Promise<unknown>) => Promise<unknown>;
  refreshProjections?: (sessionId: string) => Promise<unknown>;
}

export interface ClientContext {
  locale: {
    register: (ns: string, dictionaries: Record<string, Record<string, string>>) => void;
    bind: (ns: string) => (key: string) => string;
  };
  slots: {
    inject: (name: string, callback: () => unknown) => void;
    // Component props vary per slot; `any` keeps registration storage-neutral.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    register: (options: Record<string, unknown>, component: (props?: any) => unknown) => unknown;
  };
  effect?: (effect: () => unknown, name?: string) => void;
  connection?: import('./configuration.js').ConfigurationConnection;
  remote?: {

    pluginInventory?: { list?: () => Promise<unknown> };
    pluginManager?: { listBundles?: () => Promise<unknown> };
  };
  sessions?: SessionsService;
}
