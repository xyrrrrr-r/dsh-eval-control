/**
 * Pure derivations shared by the dashboard's tabs: occupancy, composition
 * segments, message ledger views, and the evolution chart's series/markers.
 */
import { COMPOSITION_COLORS } from './format.js';
import type { Segment } from './charts.js';
import type { ContextTimeline, ContextPressure, SessionStats, TrajectoryAnalytics } from './types.js';

export interface DashboardData {
  analytics: TrajectoryAnalytics | null;
  timeline: ContextTimeline | null;
  stats: SessionStats | null;
  contextWindow: number | null;
  utilization: number | null;
  segments: Segment[];
  /** PRD §3.2 详细列表: per-segment bounded content excerpts, keyed by segment. */
  segmentDetail: Record<string, ContextTimeline['segments'][number]>;
  surfaceTotal: number;
  messages: NonNullable<ContextTimeline['injections']>;
  messageCapNote: boolean;
  steps: NonNullable<ContextTimeline['steps']>;
  wallMs: number | null;
  running: boolean;
}

/** The surface totals, or null when the timeline view is absent/foreign. */
function surfaceOf(timeline: ContextTimeline | null): ContextTimeline['surface'] | null {
  return timeline !== null && timeline.surface !== null && typeof timeline.surface === 'object'
    ? timeline.surface
    : null;
}

/** PRD §3.1 current context: the latest request's full prompt size.
 * Provider `inputTokens` is the UNCACHED portion; the real context the model
 * saw is `inputTokens + cacheReadTokens` (falls back to input alone when the
 * provider reports no cache field). */
export function currentContextOf(timeline: ContextTimeline | null): number {
  const steps = Array.isArray(timeline?.steps) ? timeline!.steps : [];
  if (steps.length > 0) {
    const last = steps[steps.length - 1]!;
    return last.inputTokens + (last.cacheReadTokens ?? 0);
  }
  return surfaceOf(timeline)?.totalTokens ?? 0;
}

/** A step's full prompt size (uncached input + cache read). */
export function stepContextOf(step: { inputTokens: number; cacheReadTokens: number | null }): number {
  return step.inputTokens + (step.cacheReadTokens ?? 0);
}

export function deriveDashboardData(
  analytics: TrajectoryAnalytics | null,
  timeline: ContextTimeline | null,
  stats: SessionStats | null,
  pressure: ContextPressure | null,
): DashboardData {
  const contextWindow = (typeof timeline?.contextWindow === 'number' ? timeline.contextWindow : null)
    ?? (typeof pressure?.contextWindow === 'number' ? pressure.contextWindow : null);
  const inputTokens = analytics?.inputTokens ?? 0;
  /* PRD §3.1: CURRENT occupancy — the latest request's real input (what the
   * model sees now), not the session-cumulative input. */
  const currentContext = currentContextOf(timeline);
  const utilization = contextWindow !== null && contextWindow > 0 && currentContext > 0
    ? currentContext / contextWindow
    : null;
  const surface = surfaceOf(timeline);
  const segments: Segment[] = surface
    ? [
      { key: 'systemPrompt', label: '系统提示', tokens: surface.systemPrompt, color: COMPOSITION_COLORS.systemPrompt },
      { key: 'conversation', label: '对话消息', tokens: surface.conversation, color: COMPOSITION_COLORS.conversation },
      { key: 'toolDefinitions', label: '工具定义', tokens: surface.toolDefinitions, color: COMPOSITION_COLORS.toolDefinitions },
      { key: 'fileContents', label: '文件内容', tokens: surface.fileContents, color: COMPOSITION_COLORS.fileContents },
      { key: 'toolResults', label: '工具结果', tokens: surface.toolResults, color: COMPOSITION_COLORS.toolResults },
      { key: 'compactionSummary', label: '压缩摘要', tokens: surface.compactionSummary, color: COMPOSITION_COLORS.compactionSummary },
      { key: 'other', label: '其他', tokens: surface.other, color: COMPOSITION_COLORS.other },
    ]
    : [];
  const messages = Array.isArray(timeline?.injections) ? timeline!.injections : [];
  const steps = Array.isArray(timeline?.steps) ? timeline!.steps : [];
  const segmentDetail: Record<string, ContextTimeline['segments'][number]> = {};
  if (Array.isArray(timeline?.segments)) {
    for (const segment of timeline!.segments) {
      if (segment !== null && typeof segment === 'object' && typeof segment.segment === 'string') {
        segmentDetail[segment.segment] = segment;
      }
    }
  }
  const wallMs = analytics && analytics.teamInput
    ? (analytics.teamInput.factTimeMax !== null && analytics.teamInput.firstEventTimeMs !== null
      ? Math.max(0, analytics.teamInput.factTimeMax - analytics.teamInput.firstEventTimeMs)
      : null)
    : null;
  return {
    analytics,
    timeline,
    stats,
    contextWindow,
    utilization,
    segments,
    segmentDetail,
    surfaceTotal: surface?.totalTokens ?? 0,
    messages,
    messageCapNote: false,
    steps,
    wallMs,
    running: Array.isArray(analytics?.teamInput?.turnIntervals)
      ? analytics!.teamInput!.turnIntervals.some((turn) => turn.firstEndMs === null)
      : false,
  };
}

/** The §3.3 message-kind filter vocabulary. */
export const MESSAGE_KIND_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  'tool-result': '工具结果',
  system: '系统',
  developer: '开发者',
};

/** Context injection excludes ordinary tool-result feedback and assistant output. */
export function isInjected(message: { kind: string; sourceKind: string }): boolean {
  if (message.kind === 'assistant' || message.kind === 'tool-result') return false;
  if (message.kind === 'user') return message.sourceKind !== 'user';
  return true;
}

export interface EvolutionPoint {
  x: number;
  surfaceTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  timeMs: number;
  turn: number;
  step: number;
}

export function evolutionPoints(timeline: ContextTimeline | null): EvolutionPoint[] {
  return (timeline?.steps ?? []).map((step) => ({
    x: step.timeMs,
    surfaceTokens: step.surfaceTokens,
    inputTokens: step.inputTokens,
    outputTokens: step.outputTokens,
    cacheReadTokens: step.cacheReadTokens,
    timeMs: step.timeMs,
    turn: step.turn,
    step: step.step,
  }));
}

/** X for a step index: step ordinal (stable even when timestamps collide). */
export function stepOrdinal(timeline: ContextTimeline | null): number[] {
  return (timeline?.steps ?? []).map((step, index) => index + 1);
}
