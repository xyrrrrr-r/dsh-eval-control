import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CONTROL_CONFIG_ENV, isControlConfigReference, readControlConfigFile, resolveControlConfigSource,
} from '../src/control_config_source.js';
import { digestEvalControlConfig, resolveEvalControlConfig } from '../src/config.js';
import entry from '../src/sandbox_entry.js';
import plugin from '../src/index.js';

// realpathSync: macOS tmpdir (/var/…) is a symlink to /private/var, and the
// configuration validator rejects symlinked ancestors.
function root(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), 'aeval-source-'));
}

function validConfig(dir: string): Record<string, unknown> {
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
    gatewayUrl: 'http://127.0.0.1:1',
    jobTokenFile: join(dir, 'job-token'),
  };
}

test('an inline configuration is returned untouched', () => {
  const inline = { any: 'shape' };
  const source = resolveControlConfigSource(inline);
  assert.equal(source.kind, 'inline');
  assert.equal(source.config, inline, 'the same object must reach resolveEvalControlConfig');
});

test('a controlConfigPath reference reads and parses the file', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = validConfig(dir);
  writeFileSync(path, JSON.stringify(config));
  const source = resolveControlConfigSource({ controlConfigPath: path });
  assert.equal(source.kind, 'file');
  assert.equal(source.configPath, path);
  assert.deepEqual(source.config, config);
  assert.deepEqual(readControlConfigFile(path), config);
});

test('an empty row falls back to the environment, then to standalone', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = validConfig(dir);
  writeFileSync(path, JSON.stringify(config));

  assert.equal(resolveControlConfigSource({}, {}).kind, 'standalone');
  assert.match(resolveControlConfigSource({}, {}).reason ?? '', new RegExp(CONTROL_CONFIG_ENV));
  assert.equal(resolveControlConfigSource(undefined, {}).kind, 'standalone');
  assert.equal(resolveControlConfigSource(null, {}).kind, 'standalone');

  const fromEnv = resolveControlConfigSource({}, { [CONTROL_CONFIG_ENV]: path });
  assert.equal(fromEnv.kind, 'file');
  assert.equal(fromEnv.configPath, path);
  // A blank variable is not a configured deployment.
  assert.equal(resolveControlConfigSource({}, { [CONTROL_CONFIG_ENV]: '   ' }).kind, 'standalone');
});

test('a reference is the controlConfigPath shape, with or without the token override', () => {
  assert.equal(isControlConfigReference({ controlConfigPath: '/tmp/x.json' }), true);
  // The aeval runner generates its transport row with both keys; misreading
  // that row as an inline config would hand the broker a config object with
  // unknown keys and break every deployment.
  assert.equal(
    isControlConfigReference({ controlConfigPath: '/tmp/x.json', jobTokenPath: '/tmp/t' }),
    true,
  );
  assert.equal(isControlConfigReference({ controlConfigPath: '' }), false);
  assert.equal(isControlConfigReference({ controlConfigPath: '/tmp/x.json', trialId: 't' }), false);
  assert.equal(isControlConfigReference({ trialId: 't' }), false);
  assert.equal(isControlConfigReference([]), false);
  assert.equal(isControlConfigReference('controlConfigPath'), false);
});

test('a transport row with a token override resolves the file, not itself', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = validConfig(dir);
  writeFileSync(path, JSON.stringify(config));
  const source = resolveControlConfigSource({ controlConfigPath: path, jobTokenPath: '/tmp/token' });
  assert.equal(source.kind, 'file');
  assert.deepEqual(source.config, config);
});

test('unreadable and malformed configuration files fail loudly', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const missing = join(dir, 'missing.json');
  assert.throws(() => resolveControlConfigSource({ controlConfigPath: missing }), /cannot read control config/);
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{ not json');
  assert.throws(() => resolveControlConfigSource({ controlConfigPath: broken }), /is not valid JSON/);
});

test("the aeval runner's two-row patch resolves both rows to one configuration", (t) => {
  // Mirrors aeval `agents/dsh/control_flavor.py::_control_patch_yaml`: the
  // transport row carries `controlConfigPath` + `jobTokenPath`, the control
  // row inlines the complete configuration. Both rows must land on the SAME
  // canonical object, or `apply` throws "Control and broker configurations
  // differ" on every single run.
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = validConfig(dir);
  writeFileSync(path, JSON.stringify(config));

  const transportRow = { controlConfigPath: path, jobTokenPath: join(dir, 'job-token') };
  const validated = entry.Config['~standard'].validate(transportRow) as
    | { readonly value: unknown } | { readonly issues: readonly { readonly message?: string }[] };
  assert.ok('value' in validated, 'the transport row must pass the row schema');
  // The loader hands `apply` whatever the row schema produced (the raw row
  // object); resolving the reference is the step that canonicalizes it.
  const source = resolveControlConfigSource(validated.value);
  assert.equal(source.kind, 'file');
  const transportConfig = resolveEvalControlConfig(source.config);
  const controlRow = plugin.Config['~standard'].validate(config);
  assert.ok('value' in controlRow && controlRow.value !== undefined, 'the inline row must validate');
  assert.deepEqual(controlRow.value, transportConfig);
  assert.equal(digestEvalControlConfig(controlRow.value), digestEvalControlConfig(transportConfig));
});

test('the row schema accepts a reference and resolves it to the inline result', (t) => {
  const dir = root();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'config.json');
  const config = validConfig(dir);
  writeFileSync(path, JSON.stringify(config));

  const validate = plugin.Config['~standard'].validate;
  const inlineResult = validate(config);
  assert.ok('value' in inlineResult && inlineResult.value !== undefined, 'the inline configuration must validate');
  const inlineConfig = inlineResult.value;

  // The aeval path must be digest-identical: the reference resolution exists
  // only as another way to reach the same canonical configuration.
  assert.equal(
    digestEvalControlConfig(inlineConfig),
    digestEvalControlConfig(resolveEvalControlConfig(config)),
  );

  const referenceResult = validate({ controlConfigPath: path });
  assert.ok('value' in referenceResult && referenceResult.value !== undefined, 'the reference must validate');
  assert.deepEqual(referenceResult.value, inlineConfig);

  const invalid = validate({});
  assert.ok('issues' in invalid && invalid.issues !== undefined);
  assert.match(invalid.issues[0]?.message ?? '', /control configuration is required/);
});