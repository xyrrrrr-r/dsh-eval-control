/**
 * Cross-session Team aggregation (ported from the shipped client half): the
 * wire-path mirror of the host's `foldTeamMetrics`, computed from each member
 * session's bounded `teamInput` wire section. Wire caps make this a documented
 * approximation of the exact parity path; the display never claims parity.
 */
import type { SessionsService, TeamInput } from './types.js';

export interface MemberEntry {
  memberId: string;
  summary: { teamInput?: TeamInput; eventsSeen?: number } | null;
  error?: string;
}

export interface TeamAggregate {
  asOf: number | null;
  members: string[];
  busyMs: Record<string, number>;
  openFlags: Record<string, boolean>;
  activeNow: number;
  peak: number;
  wallMs: number | null;
  wallCoverage: string[];
  branchFirst: Array<{ childId: string; latencyMs?: number; status?: string }>;
  observed: Set<string>;
}

function mergeIntervalsPlain(list: Array<[number, number]>): Array<[number, number]> {
  const normalized = list.filter((pair) => pair[1] > pair[0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const interval of normalized) {
    const last = merged[merged.length - 1];
    if (last && interval[0] <= last[1]) {
      if (interval[1] > last[1]) last[1] = interval[1];
    } else merged.push([interval[0], interval[1]]);
  }
  return merged;
}

export function teamAggregate(rootInput: TeamInput, memberEntries: MemberEntry[]): TeamAggregate {
  const members = Array.isArray(rootInput.memberIds) ? rootInput.memberIds : [];
  const childInputs = new Map(memberEntries
    .filter((entry) => entry.summary && entry.summary.teamInput)
    .map((entry) => [entry.memberId, entry.summary!.teamInput!]));
  const observed = new Set([rootInput.sessionId, ...childInputs.keys()]);
  const asOfCandidates = [rootInput, ...childInputs.values()]
    .map((input) => input.factTimeMax)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  const asOf = asOfCandidates.length ? Math.max(...asOfCandidates) : null;
  const intervals: Record<string, Array<[number, number]>> = {};
  const openFlags: Record<string, boolean> = {};
  const busyMs: Record<string, number> = {};
  for (const memberId of members) {
    const input = childInputs.get(memberId);
    const turns = input && Array.isArray(input.turnIntervals) ? input.turnIntervals : [];
    const collected: Array<[number, number]> = [];
    let open = false;
    for (const turn of turns) {
      if (typeof turn.startMs !== 'number') continue;
      const end = typeof turn.firstEndMs === 'number' && turn.firstEndMs >= turn.startMs ? turn.firstEndMs : null;
      if (end !== null) collected.push([turn.startMs, end]);
      else {
        open = true;
        if (asOf !== null && asOf >= turn.startMs) collected.push([turn.startMs, asOf]);
      }
    }
    intervals[memberId] = mergeIntervalsPlain(collected);
    openFlags[memberId] = open;
    busyMs[memberId] = intervals[memberId]!.reduce((sum, pair) => sum + (pair[1] - pair[0]), 0);
  }
  const activeNow = asOf === null
    ? 0
    : members.filter((memberId) => intervals[memberId]!.some((pair) => pair[0] <= asOf && asOf < pair[1])).length;
  const sweep: Array<[number, number]> = [];
  for (const memberId of members) {
    for (const pair of intervals[memberId]!) {
      sweep.push([pair[0], 1]);
      sweep.push([pair[1], -1]);
    }
  }
  sweep.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let peak = 0;
  let cursor = 0;
  for (const entry of sweep) {
    cursor += entry[1];
    if (cursor > peak) peak = cursor;
  }
  const startCandidates: number[] = [];
  for (const child of (Array.isArray(rootInput.subagentChildren) ? rootInput.subagentChildren : [])) {
    if (child && typeof child.childId === 'string' && typeof child.childCreatedAtMs === 'number' && observed.has(child.childId)) {
      startCandidates.push(child.childCreatedAtMs);
    }
  }
  for (const memberId of members) {
    const first = childInputs.get(memberId)?.firstEventTimeMs;
    if (typeof first === 'number') startCandidates.push(first);
  }
  let wallMs: number | null = null;
  const wallCoverage: string[] = [];
  if (startCandidates.length) {
    const start = Math.min(...startCandidates);
    const ends: number[] = [];
    for (const memberId of members) {
      if (!observed.has(memberId) && !childInputs.has(memberId)) {
        continue;
      }
      const input = childInputs.get(memberId);
      const turns = (input && Array.isArray(input.turnIntervals) ? input.turnIntervals : [])
        .slice().sort((a, b) => (typeof a.turn === 'number' ? a.turn : 0) - (typeof b.turn === 'number' ? b.turn : 0));
      const closed = turns.filter((turn) => typeof turn.firstEndMs === 'number' && turn.firstEndMs >= turn.startMs);
      if (closed.length > 0 && closed.length === turns.length) ends.push(closed[closed.length - 1]!.firstEndMs!);
      else wallCoverage.push('member_terminal_missing');
    }
    if (ends.length) wallMs = Math.max(Math.max(...ends) - start, 0);
  }
  const branchFirst: TeamAggregate['branchFirst'] = [];
  for (const child of (Array.isArray(rootInput.subagentChildren) ? rootInput.subagentChildren : [])) {
    if (!child || typeof child.childId !== 'string' || typeof child.childCreatedAtMs !== 'number') continue;
    const input = childInputs.get(child.childId);
    const first = input ? input.firstEventTimeMs : null;
    if (typeof first !== 'number') {
      branchFirst.push({ childId: child.childId, status: input ? 'child_first_event_missing' : 'child_session_not_observed' });
    } else {
      branchFirst.push({ childId: child.childId, latencyMs: first - child.childCreatedAtMs });
    }
  }
  return { asOf, members, busyMs, openFlags, activeNow, peak, wallMs, wallCoverage, branchFirst, observed };
}

/**
 * Read one member session's analytics wire view without leaving a scope open.
 * The projections RPC seeds the client's shared per-session store without
 * activating an Agent; using() then borrows that store. Generalized over the
 * original to read several projection keys at once (comparison tab).
 */
export async function readSessionProjections(
  sessions: SessionsService,
  sessionId: string,
  keys: string[],
): Promise<Record<string, unknown> | null> {
  try {
    if (typeof sessions.refreshProjections === 'function') await sessions.refreshProjections(sessionId);
  } catch { /* degrade: read whatever the client already holds */ }
  return (await sessions.using?.(sessionId, { source: 'dsh-eval-control-analytics' }, async (reference) => {
    try {
      await Promise.race([
        (reference as { ready?: Promise<unknown> }).ready,
        new Promise((resolve) => { setTimeout(resolve, 2000); }),
      ]);
    } catch { /* ready rejected; the store may still hold a baseline */ }
    const binding = reference as {
      binding?: {
        session?: {
          projections?: {
            faceOf?: (key: string) => { getSnapshot?: () => unknown } | null;
          };
        };
      };
    } | null;
    const projections = binding && binding.binding && binding.binding.session && binding.binding.session.projections
      && typeof binding.binding.session.projections.faceOf === 'function'
      ? binding.binding.session.projections
      : null;
    if (!projections) return null;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const face = projections.faceOf?.(key) ?? null;
      out[key] = face && typeof face.getSnapshot === 'function' ? face.getSnapshot() : undefined;
    }
    return out;
  })) as Record<string, unknown> | null;
}

/** Back-compatible single-projection read (the Team area's member summary). */
export async function readMemberSummary(sessions: SessionsService, memberId: string): Promise<unknown> {
  const result = await readSessionProjections(sessions, memberId, ['trajectoryAnalytics']);
  return result?.['trajectoryAnalytics'] ?? undefined;
}
