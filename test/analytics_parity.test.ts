import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { foldLifecycleMetrics, initialMetricFoldState } from '../src/analytics/metrics.js';

const fixtureRoot = join(import.meta.dirname, '../../test/fixtures/trajectory_contract/v1');
type Fixture = {
  fixtureId: string;
  session: { header: { id: string }; complete: boolean };
  events: SessionEvent[];
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

function comparable(results: ReturnType<typeof initialMetricFoldState>['recentMetricResults']) {
  return [...results].sort((a, b) => a.metricId.localeCompare(b.metricId) || a.subjectId.localeCompare(b.subjectId));
}

test('DSH lifecycle fold matches the pinned aeval v1 metric goldens', () => {
  const manifest = readJson<Manifest>('manifest.json');
  assert.match(manifest.aevalRevision, /^[0-9a-f]{7,40}$/);
  for (const fixtureInfo of manifest.fixtures) {
    for (const [path, expectedHash] of Object.entries(fixtureInfo.sha256)) {
      const actualHash = createHash('sha256').update(readFileSync(join(fixtureRoot, path))).digest('hex');
      assert.equal(actualHash, expectedHash, `${fixtureInfo.fixtureId}: stale fixture digest for ${path}`);
    }
    const fixture = readJson<Fixture>(fixtureInfo.input);
    assert.equal(fixture.fixtureId, fixtureInfo.fixtureId);
    let state = initialMetricFoldState(fixture.session.header.id);
    for (const event of fixture.events) state = foldLifecycleMetrics(state, event);
    const expected = readJson<typeof state.recentMetricResults>(fixtureInfo.expectedMetrics);
    assert.deepEqual(comparable(state.recentMetricResults), comparable(expected), fixture.fixtureId);
  }
});

test('incremental fold at every event prefix equals replay from the same prefix', () => {
  const manifest = readJson<Manifest>('manifest.json');
  for (const fixtureInfo of manifest.fixtures) {
    const fixture = readJson<Fixture>(fixtureInfo.input);
    let incremental = initialMetricFoldState(fixture.session.header.id);
    for (let index = 0; index < fixture.events.length; index++) {
      incremental = foldLifecycleMetrics(incremental, fixture.events[index]!);
      let replay = initialMetricFoldState(fixture.session.header.id);
      for (const event of fixture.events.slice(0, index + 1)) replay = foldLifecycleMetrics(replay, event);
      assert.deepEqual(comparable(incremental.recentMetricResults), comparable(replay.recentMetricResults), `${fixture.fixtureId} prefix ${index + 1}`);
    }
  }
});
