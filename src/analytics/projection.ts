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
  retries: number;
  compactionStarts: number;
  compactionSummaries: number;
  compactionEnds: number;
  prunePasses: number;
  compactionShadowedTokens: number;
  pruneShadowedTokens: number;
  teamMemberSnapshots: number;
  teamTaskSnapshots: number;
  queuedTeamMessages: number;
  deliveredTeamMessages: number;
  metricResults: TrajectoryMetricResult[];
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

const eventRefSchema = z.object({ sessionId: z.string().min(1), seq: z.number().int().nonnegative() }).strict();
const metricResultSchema = z.object({
  metricId: z.enum(['tool.call_elapsed_ms', 'compaction.summary_cycles', 'compaction.elapsed_ms']),
  contractVersion: z.literal('1'),
  subjectId: z.string().min(1),
  status: z.enum(['available', 'partial', 'incomplete']),
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
  compactionStartRefs: z.array(eventRefSchema).max(64),
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
  retries: z.number().int().nonnegative(),
  compactionStarts: z.number().int().nonnegative(),
  compactionSummaries: z.number().int().nonnegative(),
  compactionEnds: z.number().int().nonnegative(),
  prunePasses: z.number().int().nonnegative(),
  compactionShadowedTokens: z.number().int().nonnegative(),
  pruneShadowedTokens: z.number().int().nonnegative(),
  teamMemberSnapshots: z.number().int().nonnegative(),
  teamTaskSnapshots: z.number().int().nonnegative(),
  queuedTeamMessages: z.number().int().nonnegative(),
  deliveredTeamMessages: z.number().int().nonnegative(),
  metricResults: z.array(metricResultSchema).max(64),
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
  stateVersion: 2,
  stateSchema,
  init: header => {
    const metricState = initialMetricFoldState(header.id);
    return {
      eventsSeen: 0, turnsStarted: 0, turnsEnded: 0, stepsStarted: 0, stepsEnded: 0,
      toolCalls: 0, toolResults: 0, toolErrors: 0, retries: 0,
      compactionStarts: 0, compactionSummaries: 0, compactionEnds: 0, prunePasses: 0,
      compactionShadowedTokens: 0, pruneShadowedTokens: 0,
      teamMemberSnapshots: 0, teamTaskSnapshots: 0, queuedTeamMessages: 0, deliveredTeamMessages: 0,
      recentEvents: [], metricState, metricResults: metricState.recentMetricResults,
    };
  },
  apply: (state, event) => {
    const metricState = foldLifecycleMetrics(state.metricState, event);
    const next: AnalyticsState = {
      ...state,
      eventsSeen: state.eventsSeen + 1,
      metricState,
      metricResults: metricState.recentMetricResults,
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
    return next;
  },
  wire: {
    viewSchema: summarySchema,
    view: ({ metricState: _metricState, ...summary }) => summary,
  },
} satisfies ProjectionDefinition<'trajectoryAnalytics'> & { wire: NonNullable<ProjectionDefinition<'trajectoryAnalytics'>['wire']> };
