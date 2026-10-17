import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TrajectoryMetricResult } from '../src/analytics/metrics.js';
import { foldLifecycleMetrics, initialMetricFoldState, sealMetricFoldState, type MetricFoldState } from '../src/analytics/metrics.js';
import { combineFoldStates } from '../src/analytics/team.js';

const fixtureRoot = join(import.meta.dirname, '../../test/fixtures/trajectory_contract/v1');
type FixtureSession = {
  header: { id: string; delegationDepth?: number };
  complete: boolean;
};
type Fixture = {
  fixtureId: string;
  session: FixtureSession;
  events: SessionEvent[];
  children?: Array<{ session: FixtureSession; events: SessionEvent[] }>;
};
type Manifest = {
  aevalRevision: string;
  fixtures: Array<{
    fixtureId: string;
    input: string;
    expectedMetrics: string;
    sha256: Record<string, string>;
  }>;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(fixtureRoot, path), 'utf8')) as T;
}

function foldSession(session: FixtureSession, events: SessionEvent[]): MetricFoldState {
  let state = initialMetricFoldState(session.header.id, {
    delegationDepth: typeof session.header.delegationDepth === 'number'
      ? session.header.delegationDepth
      : null,
  });
  for (const event of events) state = foldLifecycleMetrics(state, event);
  return sealMetricFoldState(state, session.complete !== false);
}

function comparable(results: TrajectoryMetricResult[]) {
  return [...results].sort((a, b) => a.metricId.localeCompare(b.metricId) || a.subjectId.localeCompare(b.subjectId));
}

test('DSH trajectory fold matches the pinned aeval v1 metric goldens', () => {
  const manifest = readJson<Manifest>('manifest.json');
  assert.match(manifest.aevalRevision, /^[0-9a-f]{7,40}$/);
  for (const fixtureInfo of manifest.fixtures) {
    for (const [path, expectedHash] of Object.entries(fixtureInfo.sha256)) {
      const actualHash = createHash('sha256').update(readFileSync(join(fixtureRoot, path))).digest('hex');
      assert.equal(actualHash, expectedHash, `${fixtureInfo.fixtureId}: stale fixture digest for ${path}`);
    }
    const fixture = readJson<Fixture>(fixtureInfo.input);
    assert.equal(fixture.fixtureId, fixtureInfo.fixtureId);
    const rootState = foldSession(fixture.session, fixture.events);
    const childStates = (fixture.children ?? []).map(child => foldSession(child.session, child.events));
    const combined = combineFoldStates(rootState, childStates);
    const expected = readJson<TrajectoryMetricResult[]>(fixtureInfo.expectedMetrics);
    assert.deepEqual(comparable(combined), comparable(expected), fixtureInfo.fixtureId);
  }
});

test('incremental fold at every event prefix equals replay from the same prefix', () => {
  const manifest = readJson<Manifest>('manifest.json');
  for (const fixtureInfo of manifest.fixtures) {
    const fixture = readJson<Fixture>(fixtureInfo.input);
    const sessions = [
      { session: fixture.session, events: fixture.events },
      ...(fixture.children ?? []).map(child => ({ session: child.session, events: child.events })),
    ];
    for (const { session, events } of sessions) {
      let incremental = initialMetricFoldState(session.header.id, {
        delegationDepth: typeof session.header.delegationDepth === 'number'
          ? session.header.delegationDepth
          : null,
      });
      for (let index = 0; index < events.length; index++) {
        incremental = foldLifecycleMetrics(incremental, events[index]!);
        let replay = initialMetricFoldState(session.header.id, {
          delegationDepth: typeof session.header.delegationDepth === 'number'
            ? session.header.delegationDepth
            : null,
        });
        for (const event of events.slice(0, index + 1)) replay = foldLifecycleMetrics(replay, event);
        assert.deepEqual(
          comparable(incremental.recentMetricResults),
          comparable(replay.recentMetricResults),
          `${fixtureInfo.fixtureId} ${session.header.id} prefix ${index + 1}`,
        );
      }
    }
  }
});
