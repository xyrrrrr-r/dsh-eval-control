/**
 * Environment-verification regressions.
 *
 * 1. Broker TLS material: `listen.tls.key`/`cert` are FILE PATHS. Node's
 *    TLS server parses whatever string it receives as PEM, so an inline
 *    PEM body cannot pass the control-character check and a path passed
 *    through unread fails with "no start line" — the loopback-only
 *    default hid this until a nonloopback listener was actually started
 *    on the aarch64 host.
 * 2. Sandbox entry: the control stack needs a Cordis entry that installs
 *    the broker transport before the control plugin mounts.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { test } from 'node:test';

import { parseBrokerMainConfig } from '../src/broker_main.js';
import { BROKER_WIRE_KEYS, parseBrokerRequest, wireBodyOf } from '../src/gateway_lease.js';
import entry, { apply as applyEntry } from '../src/sandbox_entry.js';

const binPath = fileURLToPath(new URL('../../dist/broker_main.js', import.meta.url));

function directory(t: TestContext): string {
  const path = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'aeval-env-regress-'));
  t.after(() => fs.rmSync(path, { recursive: true, force: true }));
  return path;
}

function baseConfig(tls: unknown) {
  return {
    run: {
      run_id: 'run-tls', job_config_hash: 'b'.repeat(64),
      config_file_sha256: 'c'.repeat(64), runtime_lock_digest: 'd'.repeat(64),
    },
    trialId: 'trial-tls', sessionId: 'session-tls', configDigest: 'a'.repeat(64),
    identity: { provider: 'offline-openai', model: 'test-model' },
    limits: { maxSteps: 5 },
    maxOutputTokens: 64,
    listen: { host: '0.0.0.0', port: 0, ...(tls === undefined ? {} : { tls }) },
    tokenOut: '/tmp/token',
    upstream: {
      provider: 'offline-openai', baseUrl: 'http://127.0.0.1:9',
      apiKeyEnv: 'AEVAL_KEY', model: 'test-model',
    },
  };
}

test('broker accepts TLS material as file paths', () => {
  const parsed = parseBrokerMainConfig(baseConfig({ key: '/etc/tls/key.pem', cert: '/etc/tls/cert.pem' }));
  assert.deepEqual(parsed.listen.tls, { key: '/etc/tls/key.pem', cert: '/etc/tls/cert.pem' });
});

test('broker rejects inline PEM material instead of starting a broken listener', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n';
  assert.throws(
    () => parseBrokerMainConfig(baseConfig({ key: pem, cert: '/etc/tls/cert.pem' })),
    /listen\.tls\.key/,
  );
  assert.throws(
    () => parseBrokerMainConfig(baseConfig({ key: '/etc/tls/key.pem', cert: '' })),
    /listen\.tls\.cert/,
  );
});

test('a nonloopback listener without TLS is refused', () => {
  const config = baseConfig(undefined);
  assert.throws(() => parseBrokerMainConfig(config), /nonloopback listeners require TLS/);
});

test('an unreadable TLS key fails loudly at startup', async (t) => {
  const root = directory(t);
  const configPath = join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(baseConfig({
    key: join(root, 'missing-key.pem'), cert: join(root, 'missing-cert.pem'),
  })));
  const child = spawn(process.execPath, [binPath, configPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AEVAL_KEY: 'offline-test-key-0123456789abcdef' },
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const code: number | null = await new Promise((resolve) => {
    child.once('close', (value) => resolve(value));
  });
  assert.notEqual(code, 0, `expected a non-zero exit, stderr: ${stderr}`);
  assert.match(stderr, /missing-key\.pem|ENOENT/);
});

test('sandbox entry refuses a missing or malformed control config', async () => {
  await assert.rejects(
    () => applyEntry({} as never, { controlConfigPath: '/nonexistent/control.json' }),
    /cannot read control config/,
  );
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'aeval-entry-cfg-'));
  try {
    const bad = join(root, 'bad.json');
    fs.writeFileSync(bad, '{not json');
    await assert.rejects(
      () => applyEntry({} as never, { controlConfigPath: bad }),
      /not valid JSON/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox entry requires controlConfigPath', async () => {
  await assert.rejects(() => applyEntry({} as never, {}), /controlConfigPath is required/);
});

test('sandbox entry exports the Cordis plugin shape', () => {
  assert.equal(entry.name, 'aeval-broker-transport');
  assert.deepEqual(entry.inject, ['llm']);
  assert.equal(typeof entry.apply, 'function');
  assert.ok(entry.Config);
});

test('the wire body is projected onto the broker contract', () => {
  // DSH's GenerateOptions carries toolHistory, which the broker's strict
  // parser rejects with AEVAL_INVALID_REQUEST; the adapter must project.
  const options = {
    provider: 'offline-openai', model: 'test-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    toolHistory: { updates: [{ name: 'x' }] },
    signal: new AbortController().signal,
  } as never;
  // the raw object is rejected by the trust boundary...
  assert.throws(() => parseBrokerRequest(options), /AEVAL_INVALID_REQUEST/);
  // ...and the projection is accepted, carrying no transport-local keys
  const body = wireBodyOf(options);
  assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'provider']);
  assert.equal(parseBrokerRequest(body).model, 'test-model');
});

test('the wire key set is exactly what the parser accepts', () => {
  const extra = { provider: 'p', model: 'm', messages: [], unexpected: 1 };
  assert.throws(() => parseBrokerRequest(extra), /AEVAL_INVALID_REQUEST/);
  for (const key of BROKER_WIRE_KEYS) {
    assert.ok(typeof key === 'string' && key.length > 0);
  }
});

test('broker main accepts a per-purpose auxiliary policy and rejects anything else', () => {
  const tls = { key: '/etc/tls/key.pem', cert: '/etc/tls/cert.pem' };
  const withPolicy = baseConfig(tls) as Record<string, unknown>;
  withPolicy['auxiliaryPolicy'] = { compaction: 'allow' };
  const parsed = parseBrokerMainConfig(withPolicy);
  assert.deepEqual(parsed.auxiliaryPolicy, { compaction: 'allow' });
  // Unknown purposes and undecided values are configuration failures.
  const unknownPurpose = baseConfig(tls) as Record<string, unknown>;
  unknownPurpose['auxiliaryPolicy'] = { research: 'allow' };
  assert.throws(() => parseBrokerMainConfig(unknownPurpose), /auxiliaryPolicy/);
  const badValue = baseConfig(tls) as Record<string, unknown>;
  badValue['auxiliaryPolicy'] = { compaction: 'sometimes' };
  assert.throws(() => parseBrokerMainConfig(badValue), /must be 'refuse' or 'allow'/);
  // A config without the key keeps the default (refuse everything).
  const plain = parseBrokerMainConfig(baseConfig(tls));
  assert.equal(plain.auxiliaryPolicy, undefined);
});
