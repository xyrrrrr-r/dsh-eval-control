import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveEvalControlConfig, EvalControlConfigSchema } from '../src/config.js';
import { readJobToken } from '../src/gateway_lease.js';
import { writeJobToken } from '../src/host_broker.js';

const base = {
  trialId: 'trial', sessionId: 'session', sessionRoot: 'sessions/session',
  configDigest: 'a'.repeat(64), provider: 'fixture', model: 'model',
  gatewayUrl: 'http://127.0.0.1:9000', jobTokenFile: '/tmp/token',
};

test('resolver and Cordis schema share defaults and preserve empty masks and fork zero', () => {
  const raw = { ...base, tools: { allow: [] }, lineage: { parentSessionId: 'parent', forkStep: 0 } };
  const config = resolveEvalControlConfig(raw);
  assert.deepEqual(EvalControlConfigSchema['~standard'].validate(raw), { value: config });
  assert.equal(config.bundlePath, 'bundle_descriptor.json');
  assert.equal(config.refuseAuxiliaryCalls, true);
  assert.deepEqual(config.tools?.allow, []);
  assert.equal(config.lineage?.forkStep, 0);
  for (const value of [config, config.tools, config.tools?.allow, config.lineage]) {
    assert.equal(Object.isFrozen(value), true);
  }
});

test('required gateway identity, safe budgets and known-key policy fail closed', () => {
  const invalid = [
    { gatewayUrl: undefined }, { jobTokenFile: undefined }, { providerRoutes: ['other'] },
    { maxSteps: 0 }, { maxSteps: 1.5 }, { maxTokens: Number.MAX_SAFE_INTEGER + 1 },
    { maxTokens: NaN }, { configDigest: 'A'.repeat(64) }, { sessionId: 'bad\nvalue' },
    { refuseAuxiliaryCalls: 'false' }, { tools: { allow: ['read', 'read'] } },
    { tools: { allow: ['invalid name'] } }, { tools: { unknown: [] } },
    { lineage: { parentSessionId: 'session' } }, { lineage: { forkStep: -1 } },
  ];
  for (const override of invalid) {
    const raw = { ...base, ...override };
    assert.throws(() => resolveEvalControlConfig(raw));
    assert.ok(EvalControlConfigSchema['~standard'].validate(raw).issues);
  }
});

test('session path and gateway boundary reject traversal, streams and credential-bearing URLs', () => {
  for (const sessionRoot of ['../session', 'C:session', 'C:/session', '/session', '\\\\server\\share',
    'session:stream', 'sessions/NUL.txt', 'sessions/name.', 'sessions/ name']) {
    assert.throws(() => resolveEvalControlConfig({ ...base, sessionRoot }));
  }
  assert.equal(resolveEvalControlConfig({ ...base, sessionRoot: '.\\sessions\\session' }).sessionRoot, 'sessions/session');
  for (const gatewayUrl of ['http://example.invalid', 'https://user:secret@example.invalid',
    'https://example.invalid?token=x', 'https://example.invalid#fragment', 'file:///tmp/socket']) {
    assert.throws(() => resolveEvalControlConfig({ ...base, gatewayUrl }));
  }
});

test('job token files fail closed without supported POSIX permissions', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aeval-token-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'token');
  const token = randomBytes(32).toString('hex');
  if (process.platform === 'win32') {
    assert.throws(() => writeJobToken(path, token), /POSIX/);
    assert.throws(() => readJobToken(path), /POSIX/);
    return;
  }
  writeJobToken(path, token);
  assert.equal(readJobToken(path), token);
  assert.throws(() => writeJobToken(path, token));
  chmodSync(path, 0o644);
  assert.throws(() => readJobToken(path), /0600/);
  chmodSync(path, 0o600);
  const link = join(root, 'link');
  symlinkSync(path, link);
  assert.throws(() => readJobToken(link));
});

test('manifest and lockfile pin direct imports to the frozen DSH slice', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { version?: string; integrity?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
  };
  assert.deepEqual(lock.packages['']?.dependencies, manifest.dependencies);
  assert.deepEqual(lock.packages['']?.devDependencies, manifest.devDependencies);
  for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version);
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.1.7-alpha.1');
  }
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh']?.integrity,
    'sha512-fim76775kLyal0lLNmpktZfOiOwU0P9qdluknL5Sm3F6ax9I5PcLD0W0WzqH9tMOOY8yHya5VShuEzSSh223sw==');
});
