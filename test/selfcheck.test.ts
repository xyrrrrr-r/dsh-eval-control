/**
 * The self-check command is exercised as a real process: it is a bin, so
 * "does it run" is part of its contract. Every other test imports modules;
 * this one spawns `dist/selfcheck.js` and reads its exit code and report.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CONTROL_CONFIG_ENV } from '../src/control_config_source.js';

const bin = fileURLToPath(new URL('../../dist/selfcheck.js', import.meta.url));

// A blank variable disables the fallback so the standalone case is really
// standalone even when the developer's shell exports one.
const baseEnv: NodeJS.ProcessEnv = { ...process.env, [CONTROL_CONFIG_ENV]: '' };

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: baseEnv });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function fixture(t: { after: (fn: () => void) => void }): { dir: string; configPath: string } {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'aeval-selfcheck-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'session'));
  writeFileSync(join(dir, 'job-token'), 'f'.repeat(64), { mode: 0o600 });
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({
    trialId: 'trial',
    sessionId: 'selected',
    sessionRoot: 'session',
    configDigest: 'a'.repeat(64),
    run: {
      run_id: 'run',
      job_config_hash: 'b'.repeat(64),
      config_file_sha256: 'c'.repeat(64),
      runtime_lock_digest: 'd'.repeat(64),
    },
    provider: 'fixture',
    model: 'model',
    bundlePath: join(dir, 'bundle_descriptor.json'),
    gatewayUrl: 'http://127.0.0.1:1',
    jobTokenFile: join(dir, 'job-token'),
  }));
  return { dir, configPath };
}

test('an unconfigured installation reports standalone and succeeds', () => {
  const result = run(['--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as { mode: string; checks: { id: string; status: string }[] };
  assert.equal(report.mode, 'standalone');
  assert.ok(report.checks.some((check) => check.id === 'node' && check.status === 'ok'));
  assert.ok(report.checks.some((check) => check.id === 'session-reader' && check.status === 'ok'));
  assert.equal(JSON.stringify(report).includes('f'.repeat(64)), false, 'the report must not leak a token');
});

test('a configured but unreachable broker fails the check with a reason', (t) => {
  const { configPath } = fixture(t);
  const result = run(['--json', '--config', configPath]);
  assert.equal(result.status, 1, 'a failing check must exit non-zero');
  const report = JSON.parse(result.stdout) as { mode: string; checks: { id: string; status: string; detail: string }[] };
  assert.equal(report.mode, 'active');
  const byId = new Map(report.checks.map((check) => [check.id, check]));
  assert.equal(byId.get('config')?.status, 'ok');
  assert.equal(byId.get('run-binding')?.status, 'ok');
  assert.equal(byId.get('job-token')?.status, 'ok');
  assert.equal(byId.get('session-root')?.status, 'ok');
  assert.equal(byId.get('broker')?.status, 'fail');
  assert.match(byId.get('broker')?.detail ?? '', /unreachable/);
  assert.equal(result.stdout.includes('f'.repeat(64)), false, 'the report must not leak a token');
});

test('a relative configuration path is rejected before any reading', () => {
  const result = run(['--config', 'config.json']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /must be an absolute path/);
});

test('--help prints usage and exits cleanly', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /usage: aeval-dsh-control-selfcheck/);
});