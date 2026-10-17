import type {
  CanonicalEventRef,
  MemberSnapshotObservation,
  MetricFoldState,
  QualityItem,
  SubagentChildObservation,
  TaskSnapshotObservation,
  TrajectoryMetricResult,
  TurnInterval,
} from './metrics.js';
import { coverageInputs } from './metrics.js';

/**
 * Cross-session Team slice of the trajectory contract.
 *
 * The per-session fold (``metrics.ts``) owns every session-scoped metric plus
 * the root-only team facts (fan-out, member idle, task blocking, delivery,
 * critical path). This module computes the metrics that genuinely need the
 * session tree — active/peak concurrency, per-member busy time, the team
 * completion wall, branch first-activity — and the root coverage override that
 * folds tree-level observation codes into the root's data-quality result.
 */

export interface TeamSessionInput {
  sessionId: string;
  /** True when the session produced at least one event (agent-entity rule). */
  hasEvents: boolean;
  firstEventTimeMs: number | null;
  lastEventRef: CanonicalEventRef | null;
  eventCount: number;
  /** Max over fact times and the last event time (the session_observed fact). */
  factTimeMax: number | null;
  turnIntervals: TurnInterval[];
  /** Root-only inputs; empty on member sessions. */
  memberIds: string[];
  teamMemberSnapshotRefs: CanonicalEventRef[];
  memberLastRefs: Record<string, CanonicalEventRef>;
  subagentChildren: SubagentChildObservation[];
  childLastRefs: Record<string, CanonicalEventRef>;
  taskSnapshots: TaskSnapshotObservation[];
  teamMemberSnapshots: MemberSnapshotObservation[];
  /** Root coverage override inputs. */
  qualityItems: QualityItem[];
  unpairedToolResultRefs: CanonicalEventRef[];
  unknownEventTypes: number;
  openSpans: number;
}

export interface TeamMetrics {
  crossSessionResults: TrajectoryMetricResult[];
  /** Rebuilt root coverage, or null when the tree adds no quality codes. */
  rootCoverage: TrajectoryMetricResult | null;
}

/** Metric families owned by the root fold; child folds never contribute them. */
const ROOT_ONLY_METRICS = new Set([
  'coordination.fan_out_width',
  'coordination.member_idle_ms',
  'coordination.task_blocked_duration',
  'coordination.team_delivery_ms',
  'coordination.team_path_critical_segments',
]);

function sortRefs(refs: CanonicalEventRef[]): CanonicalEventRef[] {
  return [...refs].sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq);
}

function lastRefs(refs: CanonicalEventRef[], cap = 64): CanonicalEventRef[] {
  return sortRefs(refs).slice(-cap);
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

function turnSpanEnd(interval: TurnInterval): number | null {
  return interval.firstEndMs !== null && interval.firstEndMs >= interval.startMs
    ? interval.firstEndMs
    : null;
}

function turnSpanRefs(input: TeamSessionInput): CanonicalEventRef[] {
  const refs: CanonicalEventRef[] = [];
  for (const interval of input.turnIntervals) {
    refs.push({ sessionId: input.sessionId, seq: interval.startSeq });
    const end = turnSpanEnd(interval);
    if (end !== null && interval.firstEndSeq !== null) {
      refs.push({ sessionId: input.sessionId, seq: interval.firstEndSeq });
    }
  }
  return refs;
}

function turnSpanRefsOf(inputs: TeamSessionInput[]): CanonicalEventRef[] {
  return inputs.flatMap(input => turnSpanRefs(input));
}

/** Exact team input from a per-session fold state (parity path). */
export function teamInputFromFoldState(state: MetricFoldState): TeamSessionInput {
  const memberLastRefs: Record<string, CanonicalEventRef> = {};
  for (const snapshot of state.teamMemberSnapshots) {
    if (snapshot.memberId !== null) memberLastRefs[snapshot.memberId] = snapshot.ref;
  }
  const childLastRefs: Record<string, CanonicalEventRef> = {};
  for (const child of state.subagentChildren) {
    if (child.childId !== null) childLastRefs[child.childId] = child.ref;
  }
  const inputs = coverageInputs(state);
  const factTimeCandidates = [...state.factTimes];
  if (state.lastEventTimeMs !== null) factTimeCandidates.push(state.lastEventTimeMs);
  return {
    sessionId: state.sessionId,
    hasEvents: state.eventCount > 0,
    firstEventTimeMs: state.firstEventTimeMs,
    lastEventRef: state.lastEventRef,
    eventCount: state.eventCount,
    factTimeMax: factTimeCandidates.length ? Math.max(...factTimeCandidates) : null,
    turnIntervals: state.turnIntervals,
    memberIds: [...new Set(state.teamMemberIds)].sort(),
    teamMemberSnapshotRefs: state.teamMemberSnapshotRefs,
    memberLastRefs,
    subagentChildren: state.subagentChildren,
    childLastRefs,
    taskSnapshots: state.taskSnapshots,
    teamMemberSnapshots: state.teamMemberSnapshots,
    qualityItems: state.qualityItems,
    unpairedToolResultRefs: inputs.unpairedToolResultRefs,
    unknownEventTypes: inputs.unknownEventTypes,
    openSpans: inputs.openSpans,
  };
}

function memberBusyIntervals(
  memberIds: string[],
  childById: Map<string, TeamSessionInput>,
  asOfMs: number | null,
): Map<string, Array<[number, number]>> {
  const intervals = new Map<string, Array<[number, number]>>();
  for (const memberId of memberIds) {
    const member = childById.get(memberId);
    const collected: Array<[number, number]> = [];
    for (const interval of member?.turnIntervals ?? []) {
      const end = turnSpanEnd(interval);
      if (end !== null) {
        collected.push([interval.startMs, end]);
      } else if (asOfMs !== null && asOfMs >= interval.startMs) {
        collected.push([interval.startMs, asOfMs]);
      }
    }
    intervals.set(memberId, unionIntervals(collected));
  }
  return intervals;
}

function memberBusyResults(
  root: TeamSessionInput,
  memberIds: string[],
  childById: Map<string, TeamSessionInput>,
  observedSessions: Set<string>,
  intervals: Map<string, Array<[number, number]>>,
): TrajectoryMetricResult[] {
  if (!memberIds.length) {
    return [{
      metricId: 'coordination.member_busy_ms', contractVersion: '1', subjectId: root.sessionId,
      status: 'unavailable', unit: 'ms', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    }];
  }
  const results: TrajectoryMetricResult[] = [];
  for (const memberId of memberIds) {
    const member = childById.get(memberId);
    const memberIntervals = intervals.get(memberId) ?? [];
    const busyMs = memberIntervals.reduce((sum, [start, end]) => sum + (end - start), 0);
    const openEvidence = (member?.turnIntervals ?? []).some(
      interval => turnSpanEnd(interval) === null,
    );
    const observed = observedSessions.has(memberId);
    const qualityRefs = [
      ...(openEvidence ? ['member_busy_open'] : []),
      ...(!observed ? ['member_session_not_observed'] : []),
    ].sort();
    results.push({
      metricId: 'coordination.member_busy_ms', contractVersion: '1', subjectId: memberId,
      status: openEvidence || !observed ? 'partial' : 'available',
      value: busyMs, unit: 'ms',
      sampleCount: memberIntervals.length, denominator: memberIntervals.length,
      evidenceRefs: lastRefs(member ? turnSpanRefs(member) : []),
      qualityRefs, evidenceLevel: 'derived',
    });
  }
  return results;
}

function activeMembersNowResult(
  root: TeamSessionInput,
  memberIds: string[],
  observedSessions: Set<string>,
  intervals: Map<string, Array<[number, number]>>,
  asOfMs: number | null,
): TrajectoryMetricResult {
  if (!memberIds.length) {
    return {
      metricId: 'coordination.active_members_now', contractVersion: '1', subjectId: root.sessionId,
      status: 'unavailable', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  let active = 0;
  if (asOfMs !== null) {
    for (const memberId of memberIds) {
      if ((intervals.get(memberId) ?? []).some(([start, end]) => start <= asOfMs && asOfMs < end)) {
        active += 1;
      }
    }
  }
  const missing = memberIds.some(memberId => !observedSessions.has(memberId));
  return {
    metricId: 'coordination.active_members_now', contractVersion: '1', subjectId: root.sessionId,
    status: missing ? 'partial' : 'available', value: active,
    sampleCount: memberIds.length, denominator: memberIds.length,
    evidenceRefs: lastRefs(root.teamMemberSnapshotRefs),
    qualityRefs: missing ? ['member_session_not_observed'] : [],
    evidenceLevel: 'derived',
  };
}

function peakConcurrentMembersResult(
  root: TeamSessionInput,
  memberIds: string[],
  memberInputs: TeamSessionInput[],
  observedSessions: Set<string>,
  intervals: Map<string, Array<[number, number]>>,
): TrajectoryMetricResult {
  if (!memberIds.length) {
    return {
      metricId: 'coordination.peak_concurrent_members', contractVersion: '1', subjectId: root.sessionId,
      status: 'unavailable', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  const events: Array<[number, number]> = [];
  for (const memberIntervals of intervals.values()) {
    for (const [start, end] of memberIntervals) {
      events.push([start, 1]);
      events.push([end, -1]);
    }
  }
  let peak = 0;
  let current = 0;
  for (const [, delta] of [...events].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    current += delta;
    peak = Math.max(peak, current);
  }
  const missing = memberIds.some(memberId => !observedSessions.has(memberId));
  const openEvidence = memberInputs.some(input =>
    input.turnIntervals.some(interval => turnSpanEnd(interval) === null),
  );
  const qualityRefs = [
    ...(missing ? ['member_session_not_observed'] : []),
    ...(openEvidence ? ['member_busy_open'] : []),
  ].sort();
  return {
    metricId: 'coordination.peak_concurrent_members', contractVersion: '1', subjectId: root.sessionId,
    status: missing || openEvidence ? 'partial' : 'available', value: peak,
    sampleCount: memberIds.length, denominator: memberIds.length,
    evidenceRefs: lastRefs(turnSpanRefsOf(memberInputs)),
    qualityRefs, evidenceLevel: 'derived',
  };
}

function teamCompletionWallResult(
  root: TeamSessionInput,
  memberIds: string[],
  childById: Map<string, TeamSessionInput>,
  observedSessions: Set<string>,
): TrajectoryMetricResult | null {
  if (!memberIds.length) return null;
  const startCandidates: number[] = [];
  for (const child of root.subagentChildren) {
    if (child.childId !== null && child.childCreatedAtMs !== null && observedSessions.has(child.childId)) {
      startCandidates.push(child.childCreatedAtMs);
    }
  }
  for (const memberId of memberIds) {
    const member = childById.get(memberId);
    if (member?.firstEventTimeMs != null) startCandidates.push(member.firstEventTimeMs);
  }
  const byTask = new Map<string, TaskSnapshotObservation[]>();
  for (const snapshot of root.taskSnapshots) {
    if (snapshot.taskId === null) continue;
    const list = byTask.get(snapshot.taskId) ?? [];
    list.push(snapshot);
    byTask.set(snapshot.taskId, list);
  }
  for (const snapshots of byTask.values()) {
    const ordered = [...snapshots].sort((a, b) => a.ref.seq - b.ref.seq);
    const started = ordered.find(
      snapshot => snapshot.status === 'in_progress' || snapshot.status === 'completed',
    );
    if (started) startCandidates.push(started.timeMs);
  }
  if (!startCandidates.length) {
    return {
      metricId: 'coordination.team_completion_wall_ms', contractVersion: '1', subjectId: root.sessionId,
      status: 'unavailable', unit: 'ms', sampleCount: 0, denominator: 0,
      evidenceRefs: [], qualityRefs: [], evidenceLevel: 'derived',
    };
  }
  const start = Math.min(...startCandidates);
  const endCandidates: number[] = [];
  const coverageMissing: string[] = [];
  for (const snapshots of byTask.values()) {
    const ordered = [...snapshots].sort((a, b) => a.ref.seq - b.ref.seq);
    const latest = ordered[ordered.length - 1]!;
    if (latest.status === 'completed' || latest.status === 'deleted') {
      endCandidates.push(latest.timeMs);
    } else {
      coverageMissing.push('task_terminal_missing');
    }
  }
  for (const snapshot of root.teamMemberSnapshots) {
    if (snapshot.phase === 'failed') endCandidates.push(snapshot.timeMs);
  }
  for (const memberId of memberIds) {
    const member = childById.get(memberId);
    if (!observedSessions.has(memberId)) {
      coverageMissing.push('member_session_not_observed');
      continue;
    }
    const intervals = [...(member?.turnIntervals ?? [])].sort((a, b) => a.turn - b.turn);
    const closed = intervals.filter(interval => turnSpanEnd(interval) !== null);
    if (closed.length > 0 && closed.length === intervals.length) {
      const lastClosed = closed[closed.length - 1]!;
      endCandidates.push(turnSpanEnd(lastClosed)!);
    } else {
      coverageMissing.push('member_terminal_missing');
    }
  }
  const childFactRefs = root.subagentChildren.map(child => child.ref);
  if (!endCandidates.length) {
    return {
      metricId: 'coordination.team_completion_wall_ms', contractVersion: '1', subjectId: root.sessionId,
      status: 'incomplete', unit: 'ms', sampleCount: 0, denominator: memberIds.length,
      evidenceRefs: lastRefs(childFactRefs),
      qualityRefs: ['team_terminal_missing'], evidenceLevel: 'derived',
    };
  }
  const end = Math.max(...endCandidates);
  return {
    metricId: 'coordination.team_completion_wall_ms', contractVersion: '1', subjectId: root.sessionId,
    status: coverageMissing.length ? 'partial' : 'available',
    value: Math.max(end - start, 0), unit: 'ms',
    sampleCount: memberIds.length, denominator: memberIds.length,
    evidenceRefs: lastRefs([...childFactRefs, ...root.taskSnapshots.map(snapshot => snapshot.ref)]),
    qualityRefs: [...new Set(coverageMissing)].sort(), evidenceLevel: 'derived',
  };
}

function branchFirstActivityResults(
  root: TeamSessionInput,
  childById: Map<string, TeamSessionInput>,
): TrajectoryMetricResult[] {
  const results: TrajectoryMetricResult[] = [];
  for (const child of root.subagentChildren) {
    if (child.childId === null || child.childCreatedAtMs === null) continue;
    const observed = childById.get(child.childId);
    const firstTime = observed?.firstEventTimeMs ?? null;
    if (firstTime === null) {
      results.push({
        metricId: 'coordination.branch_first_activity_ms', contractVersion: '1', subjectId: child.childId,
        status: 'unavailable', unit: 'ms', sampleCount: 0, denominator: 1,
        evidenceRefs: [child.ref],
        qualityRefs: [observed ? 'child_first_event_missing' : 'child_session_not_observed'],
        evidenceLevel: 'derived',
      });
      continue;
    }
    const latency = firstTime - child.childCreatedAtMs;
    results.push({
      metricId: 'coordination.branch_first_activity_ms', contractVersion: '1', subjectId: child.childId,
      status: latency >= 0 ? 'available' : 'partial',
      value: latency, unit: 'ms', sampleCount: 1, denominator: 1,
      evidenceRefs: sortRefs(observed!.lastEventRef
        ? [child.ref, observed!.lastEventRef]
        : [child.ref]),
      qualityRefs: latency < 0 ? ['branch_first_activity_negative'] : [],
      evidenceLevel: 'derived',
    });
  }
  return results;
}

function rootCoverageOverride(
  root: TeamSessionInput,
  childById: Map<string, TeamSessionInput>,
  observedSessions: Set<string>,
): TrajectoryMetricResult | null {
  const additions: QualityItem[] = [];
  for (const memberId of Object.keys(root.memberLastRefs).sort()) {
    const member = childById.get(memberId);
    const entityObserved = (member?.hasEvents ?? false) || (memberId === root.sessionId && root.hasEvents);
    if (!entityObserved) {
      additions.push({ code: 'member_session_not_observed', refs: [root.memberLastRefs[memberId]!] });
    }
  }
  for (const childId of Object.keys(root.childLastRefs).sort()) {
    if (!observedSessions.has(childId) && childId !== root.sessionId) {
      additions.push({ code: 'child_session_not_observed', refs: [root.childLastRefs[childId]!] });
    }
  }
  if (!additions.length) return null;
  const qualityItems = [...root.qualityItems, ...additions];
  const codes = new Set(qualityItems.map(item => item.code));
  return {
    metricId: 'data_quality.trajectory_coverage', contractVersion: '1', subjectId: root.sessionId,
    status: 'available',
    value: {
      unknownEventTypes: root.unknownEventTypes,
      unpairedToolResults: root.unpairedToolResultRefs.length,
      openSpans: root.openSpans,
      qualityIssueCount: qualityItems.length,
      qualityCodes: [...codes].sort(),
    },
    sampleCount: root.eventCount, denominator: root.eventCount,
    evidenceRefs: lastRefs([
      ...qualityItems.flatMap(item => item.refs),
      ...root.unpairedToolResultRefs,
    ]),
    qualityRefs: [], evidenceLevel: 'derived',
  };
}

/**
 * Compute the cross-session Team slice plus the root coverage override.
 *
 * Mirrors aeval's ``reduce_active_members_now`` / ``reduce_peak_concurrent_members``
 * / ``reduce_member_busy_ms`` / ``reduce_team_completion_wall_ms`` /
 * ``reduce_branch_first_activity_ms`` and the tree-level quality codes
 * ``member_session_not_observed`` / ``child_session_not_observed``.
 */
export function foldTeamMetrics(
  root: TeamSessionInput,
  children: TeamSessionInput[],
): TeamMetrics {
  const childById = new Map(children.map(child => [child.sessionId, child]));
  const observedSessions = new Set<string>([root.sessionId, ...children.map(child => child.sessionId)]);
  const memberIds = root.memberIds;
  const memberInputs = memberIds
    .map(memberId => childById.get(memberId))
    .filter((input): input is TeamSessionInput => input !== undefined);
  const factTimeCandidates = [root, ...children]
    .map(input => input.factTimeMax)
    .filter((value): value is number => value !== null);
  const asOfMs = factTimeCandidates.length ? Math.max(...factTimeCandidates) : null;
  const intervals = memberBusyIntervals(memberIds, childById, asOfMs);
  const crossSessionResults: TrajectoryMetricResult[] = [
    ...memberBusyResults(root, memberIds, childById, observedSessions, intervals),
    activeMembersNowResult(root, memberIds, observedSessions, intervals, asOfMs),
    peakConcurrentMembersResult(root, memberIds, memberInputs, observedSessions, intervals),
  ];
  const wall = teamCompletionWallResult(root, memberIds, childById, observedSessions);
  if (wall) crossSessionResults.push(wall);
  crossSessionResults.push(...branchFirstActivityResults(root, childById));
  return {
    crossSessionResults,
    rootCoverage: rootCoverageOverride(root, childById, observedSessions),
  };
}

function sortResults(results: TrajectoryMetricResult[]): TrajectoryMetricResult[] {
  return [...results].sort((a, b) =>
    a.metricId.localeCompare(b.metricId) || a.subjectId.localeCompare(b.subjectId));
}

/**
 * Combine the per-session fold states of a session tree into the full v1
 * metric list — the parity harness's view of ``reduce_canonical_trajectory``.
 */
export function combineFoldStates(
  rootState: MetricFoldState,
  childStates: MetricFoldState[],
): TrajectoryMetricResult[] {
  const rootInput = teamInputFromFoldState(rootState);
  const childInputs = childStates.map(teamInputFromFoldState);
  const team = foldTeamMetrics(rootInput, childInputs);
  const rootResults = rootState.recentMetricResults.map(result =>
    result.metricId === 'data_quality.trajectory_coverage' && team.rootCoverage
      ? team.rootCoverage
      : result,
  );
  const childResults = childStates.flatMap(state =>
    state.recentMetricResults.filter(result => !ROOT_ONLY_METRICS.has(result.metricId)),
  );
  return sortResults([...rootResults, ...childResults, ...team.crossSessionResults]);
}

/**
 * Combine wire views for the live client: per-session metric results plus the
 * team slice recomputed from the (bounded) team inputs each view carries.
 */
export function combineTeamViews(inputs: Array<{
  sessionId: string;
  isRoot: boolean;
  metricResults: TrajectoryMetricResult[];
  teamInput: TeamSessionInput;
}>): TrajectoryMetricResult[] {
  const root = inputs.find(input => input.isRoot);
  if (!root) return [];
  const children = inputs.filter(input => !input.isRoot);
  const team = foldTeamMetrics(root.teamInput, children.map(input => input.teamInput));
  const rootResults = root.metricResults.map(result =>
    result.metricId === 'data_quality.trajectory_coverage' && team.rootCoverage
      ? team.rootCoverage
      : result,
  );
  const childResults = children.flatMap(input =>
    input.metricResults.filter(result => !ROOT_ONLY_METRICS.has(result.metricId)),
  );
  return sortResults([...rootResults, ...childResults, ...team.crossSessionResults]);
}
