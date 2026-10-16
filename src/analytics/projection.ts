import { z } from 'zod';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { foldLifecycleMetrics, initialMetricFoldState, isToolResultSurfaceReplacement, type MetricFoldState, type TrajectoryMetricResult } from './metrics.js';
import '@deepseek-ai/dsh-compaction/types';
import '@deepseek-ai/dsh-llm-retry/types';
import '@deepseek-ai/dsh-experimental-agent-team/types';

export interface AnalyticsSummary {
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
  metricResults: TrajectoryMetricResult[];
  turnTrend: Array<{ turn: number; toolCalls: number; toolErrors: number; retries: number; compactionStarts: number; inputTokens: number }>;
  recentEvents: Array<{ seq: number; time: number; type: string; label?: string | undefined; callId?: string | undefined }>;
}

export interface AnalyticsState extends AnalyticsSummary {
  metricState: MetricFoldState;
  recentEvents: AnalyticsSummary['recentEvents'];
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    trajectoryAnalytics: AnalyticsSummary;
  }
  interface SessionProjectionStateMap {
    trajectoryAnalytics: AnalyticsState;
  }
}

const recentEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().nonnegative(),
  type: z.string(),
  label: z.string().optional(),
  callId: z.string().optional(),
}).strict();
const turnTrendSchema = z.object({
  turn: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  compactionStarts: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
}).strict();

const eventRefSchema = z.object({ sessionId: z.string().min(1), seq: z.number().int().nonnegative() }).strict();
const metricResultSchema = z.object({
  metricId: z.enum(['tool.call_elapsed_ms', 'tool.failure_rate', 'compaction.summary_cycles', 'compaction.elapsed_ms']),
  contractVersion: z.literal('1'),
  subjectId: z.string().min(1),
  status: z.enum(['available', 'partial', 'incomplete', 'unavailable']),
  value: z.union([
    z.number(),
    z.object({ closedCount: z.number().int().nonnegative(), openCount: z.number().int().nonnegative() }).strict(),
  ]).optional(),
  unit: z.literal('ms').optional(),
  sampleCount: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative().optional(),
  evidenceRefs: z.array(eventRefSchema),
  qualityRefs: z.array(z.string()),
  evidenceLevel: z.literal('derived'),
}).strict();
const metricFoldStateSchema = z.object({
  sessionId: z.string().min(1),
  openToolCalls: z.record(z.string(), z.object({ timeMs: z.number().nonnegative(), seq: z.number().int().nonnegative() }).strict()),
  openCompactions: z.record(z.string(), z.object({ timeMs: z.number().nonnegative(), seq: z.number().int().nonnegative() }).strict()),
  compactionStartedCount: z.number().int().nonnegative(),
  compactionClosedCount: z.number().int().nonnegative(),
  compactionElapsedMs: z.number().nonnegative(),
  compactionStartRefs: z.array(eventRefSchema).max(64),
  toolResultByCallId: z.record(z.string(), z.boolean().nullable()),
  duplicateToolResultIds: z.record(z.string(), z.literal(true)),
  toolResultRefs: z.array(eventRefSchema).max(64),
  toolResultMissingIdCount: z.number().int().nonnegative(),
  recentMetricResults: z.array(metricResultSchema).max(64),
}).strict();

const summarySchema = z.object({
  eventsSeen: z.number().int().nonnegative(),
  turnsStarted: z.number().int().nonnegative(),
  turnsEnded: z.number().int().nonnegative(),
  stepsStarted: z.number().int().nonnegative(),
  stepsEnded: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  toolResults: z.number().int().nonnegative(),
  toolErrors: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  inputUsageSteps: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  compactionStarts: z.number().int().nonnegative(),
  compactionSummaries: z.number().int().nonnegative(),
  compactionEnds: z.number().int().nonnegative(),
  prunePasses: z.number().int().nonnegative(),
  compactionShadowedTokens: z.number().int().nonnegative(),
  pruneShadowedTokens: z.number().int().nonnegative(),
  compactionElapsedMs: z.number().nonnegative(),
  teamMemberSnapshots: z.number().int().nonnegative(),
  teamTaskSnapshots: z.number().int().nonnegative(),
  queuedTeamMessages: z.number().int().nonnegative(),
  deliveredTeamMessages: z.number().int().nonnegative(),
  metricResults: z.array(metricResultSchema).max(64),
  turnTrend: z.array(turnTrendSchema).max(32),
  recentEvents: z.array(recentEventSchema).max(64),
}).strict();

const stateSchema = summarySchema.extend({ metricState: metricFoldStateSchema });
const MAX_RECENT_EVENTS = 64;

function safeLabel(event: SessionEvent): string | undefined {
  switch (event.type) {
    case 'tool/call': return event.data.name;
    case 'team/task': return event.data.task.subject;
    case 'team/member': return event.data.member.name;
    default: return undefined;
  }
}

/** Bounded, privacy-conscious first projection for the ordinary-user surface. */
export const trajectoryAnalyticsProjection = {
  key: 'trajectoryAnalytics',
  stateVersion: 4,
  stateSchema,
  init: header => {
    const metricState = initialMetricFoldState(header.id);
    return {
      eventsSeen: 0, turnsStarted: 0, turnsEnded: 0, stepsStarted: 0, stepsEnded: 0,
      toolCalls: 0, toolResults: 0, toolErrors: 0, inputTokens: 0, inputUsageSteps: 0, retries: 0,
      compactionStarts: 0, compactionSummaries: 0, compactionEnds: 0, prunePasses: 0,
      compactionShadowedTokens: 0, pruneShadowedTokens: 0, compactionElapsedMs: 0,
      teamMemberSnapshots: 0, teamTaskSnapshots: 0, queuedTeamMessages: 0, deliveredTeamMessages: 0,
      recentEvents: [], metricState, metricResults: metricState.recentMetricResults, turnTrend: [],
    };
  },
  apply: (state, event) => {
    const metricState = foldLifecycleMetrics(state.metricState, event);
    const next: AnalyticsState = {
      ...state,
      eventsSeen: state.eventsSeen + 1,
      metricState,
      metricResults: metricState.recentMetricResults,
      compactionElapsedMs: metricState.compactionElapsedMs,
    };
    let relevant = true;
    switch (event.type) {
      case 'turn/start': next.turnsStarted++; break;
      case 'turn/end': next.turnsEnded++; break;
      case 'step/start': next.stepsStarted++; break;
      case 'step/end': next.stepsEnded++; break;
      case 'tool/call': next.toolCalls++; break;
      case 'tool/result':
        if (!isToolResultSurfaceReplacement(event)) {
          next.toolResults++;
          if (event.data.message.isError) next.toolErrors++;
        }
        break;
      case 'assistant/message':
        if (event.data.usage?.inputTokens !== undefined) {
          next.inputTokens += event.data.usage.inputTokens;
          next.inputUsageSteps++;
        }
        break;
      case 'llm/retry': next.retries++; break;
      case 'compaction/start': next.compactionStarts++; break;
      case 'compaction/summary':
        next.compactionSummaries++;
        next.compactionShadowedTokens += event.data.shadowedTokenCount;
        break;
      case 'compaction/end': next.compactionEnds++; break;
      case 'compaction/prune':
        next.prunePasses++;
        next.pruneShadowedTokens += event.data.shadowedTokenCount;
        break;
      case 'team/member': next.teamMemberSnapshots++; break;
      case 'team/task': next.teamTaskSnapshots++; break;
      case 'team/message/queued': next.queuedTeamMessages++; break;
      case 'team/message/delivered': next.deliveredTeamMessages++; break;
      default: relevant = false;
    }
    if (!relevant) return { ...next, recentEvents: state.recentEvents };
    const label = safeLabel(event);
    const summary = {
      seq: event.seq,
      time: event.time,
      type: event.type,
      ...(label === undefined ? {} : { label }),
      ...(event.type === 'tool/call' ? { callId: String(event.data.callId) } : {}),
    };
    next.recentEvents = [...state.recentEvents, summary].slice(-MAX_RECENT_EVENTS);
    const turn = turnOf(event);
    if (turn !== undefined) next.turnTrend = foldTurnTrend(state.turnTrend, turn, event);
    return next;
  },
  wire: {
    viewSchema: summarySchema,
    view: ({ metricState: _metricState, ...summary }) => summary,
  },
} satisfies ProjectionDefinition<'trajectoryAnalytics'> & { wire: NonNullable<ProjectionDefinition<'trajectoryAnalytics'>['wire']> };

function turnOf(event: SessionEvent): number | undefined {
  switch (event.type) {
    case 'turn/start': case 'turn/end': case 'step/start': case 'step/end': case 'tool/call': case 'tool/result':
    case 'assistant/message': case 'assistant/attempt': case 'llm/retry': case 'llm/retry-started':
      return event.data.turn;
    case 'compaction/start': case 'compaction/end':
      return event.data.turn ?? undefined;
    default: return undefined;
  }
}

function foldTurnTrend(
  previous: AnalyticsSummary['turnTrend'],
  turn: number,
  event: SessionEvent,
): AnalyticsSummary['turnTrend'] {
  const items = [...previous];
  let index = items.findIndex(item => item.turn === turn);
  if (index < 0) {
    items.push({ turn, toolCalls: 0, toolErrors: 0, retries: 0, compactionStarts: 0, inputTokens: 0 });
    index = items.length - 1;
  }
  const current = items[index]!;
  let delta: Partial<AnalyticsSummary['turnTrend'][number]> = {};
  switch (event.type) {
    case 'tool/call': delta = { toolCalls: 1 }; break;
    case 'tool/result': if (!isToolResultSurfaceReplacement(event) && event.data.message.isError) delta = { toolErrors: 1 }; break;
    case 'llm/retry': delta = { retries: 1 }; break;
    case 'compaction/start': delta = { compactionStarts: 1 }; break;
    case 'assistant/message': delta = { inputTokens: event.data.usage?.inputTokens ?? 0 }; break;
  }
  items[index] = {
    ...current,
    toolCalls: current.toolCalls + (delta.toolCalls ?? 0),
    toolErrors: current.toolErrors + (delta.toolErrors ?? 0),
    retries: current.retries + (delta.retries ?? 0),
    compactionStarts: current.compactionStarts + (delta.compactionStarts ?? 0),
    inputTokens: current.inputTokens + (delta.inputTokens ?? 0),
  };
  return items.slice(-32);
}
