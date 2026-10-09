import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import plugin from '../src/index.js';
import entry from '../src/sandbox_entry.js';
import { readControlStatus } from '../src/control_status.js';

function root(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), 'aeval-standalone-'));
}

function configFor(dir: string): Record<string, unknown> {
  return {
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
    // A closed loopback port: the broker can never answer.
    gatewayUrl: 'http://127.0.0.1:1',
    jobTokenFile: join(dir, 'job-token'),
  };
}

function writeToken(dir: string): void {
  writeFileSync(join(dir, 'job-token'), 'f'.repeat(64), { mode: 0o600 });
}

test('a row with no configuration stands alone instead of failing activation', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });

  return entry.apply(ctx, {}).then(() => {
    const status = readControlStatus(ctx);
    assert.equal(status?.mode, 'standalone');
    assert.equal(status?.plugin, 'dsh-eval-control');
    // Nothing is mounted, so no provider route is registered and the control
    // row can never activate (it injects `evalBroker`).
    assert.equal((ctx as unknown as { evalBroker?: unknown }).evalBroker, undefined);
    assert.equal((ctx as unknown as { evalControl?: unknown }).evalControl, undefined);
  });
});

test('a supplied but unreadable configuration still fails loudly', async (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); });
  await assert.rejects(
    entry.apply(ctx, { controlConfigPath: join(dir, 'missing.json') }),
    /cannot read control config/,
  );
  assert.equal(readControlStatus(ctx), undefined, 'a refused install must not report a status');
});

test('a configured row whose broker is unreachable refuses to install', async (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'session'));
  writeToken(dir);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(configFor(dir)));

  const ctx = new Context();
  new LlmRuntime(ctx);
  t.after(async () => { await ctx.fiber.dispose(); });

  await assert.rejects(entry.apply(ctx, { controlConfigPath: configPath }));
  assert.equal(readControlStatus(ctx), undefined, 'fail-closed installs publish no active status');
  assert.equal((ctx as unknown as { evalBroker?: unknown }).evalBroker, undefined);
});

test('the aeval-shaped transport row (reference + token override) reads the file', async (t) => {
  // aeval's generated patch gives the transport row BOTH keys. If that shape
  // were mistaken for an inline configuration, the broker would be handed an
  // object with unknown keys and every deployment would fail before it ever
  // reached the network. Reaching the network proves the file was read.
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'session'));
  writeToken(dir);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(configFor(dir)));

  const ctx = new Context();
  new LlmRuntime(ctx);
  t.after(async () => { await ctx.fiber.dispose(); });

  let failure: Error | undefined;
  await entry.apply(ctx, {
    controlConfigPath: configPath,
    jobTokenPath: join(dir, 'job-token'),
  }).then(
    () => { throw new Error('the closed broker port must refuse installation'); },
    (error: Error) => { failure = error; },
  );
  assert.ok(failure !== undefined);
  assert.doesNotMatch(failure.message, /unknown key|is required/, 'the row was not read as a reference');
  assert.match(failure.message, /fetch failed|ECONNREFUSED|connect|socket|network/iu);
});

test('the control row refuses to run without the transport row', () => {
  const ctx = new Context();
  assert.throws(
    () => plugin.apply(ctx, configFor('/tmp')),
    /broker transport is not installed/,
  );
});