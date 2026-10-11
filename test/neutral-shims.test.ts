import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The neutral modules this package no longer owns (source of truth:
// aeval/control). What we commit here — the type shims in src/ and the
// composed runtime in dist/ — must match the sibling's build when the
// sibling checkout is present; otherwise the committed bytes are the
// record and this test skips (never passes on absence).
const NEUTRAL_MODULES = [
  'broker_main',
  'host_broker',
  'upstream',
  'gateway_lease',
  'token_bound',
  'config',
  'stop_reason',
] as const;

// `broker_main` is the one neutral module dist/ does NOT keep verbatim: it is a
// subprocess entry aeval executes directly (aeval/control/broker.py:
// `node <broker_main.js> <config.json>`), so the build bundles it with its
// imports inlined — a peer-provided copy does not exist in a profile where only
// `dependencies` were installed. The anti-fork guarantee is kept where it
// belongs instead: the pristine bytes stay in vendor/neutral and are compared
// below, and test/packaging.test.ts asserts the shipped entry is self-contained.
const COMPOSED_VERBATIM = NEUTRAL_MODULES.filter((name) => name !== 'broker_main');

// `npm test` runs COMPILED tests from `.test-dist/test/`, so the repository
// root is two levels up. Deriving it as one level above `import.meta.dirname`
// pointed at `.test-dist/`, which made this freshness guard skip forever even
// with the sibling checkout present — a guard that never runs is worse than no
// guard, because it reports as "skipped, by design".
const root = fileURLToPath(new URL('../../', import.meta.url));
const neutralDist = join(root, '..', 'aeval', 'control', 'dist');

test('composed neutral files match the sibling aeval/control build', { skip: !existsSync(neutralDist) ? 'sibling aeval/control/dist not present (standalone clone)' : false }, () => {
  for (const name of COMPOSED_VERBATIM) {
    assert.equal(
      readFileSync(join(root, 'src', `${name}.d.ts`), 'utf8'),
      readFileSync(join(neutralDist, `${name}.d.ts`), 'utf8'),
      `src/${name}.d.ts shim drifted from the neutral build`,
    );
    assert.equal(
      readFileSync(join(root, 'dist', `${name}.js`), 'utf8'),
      readFileSync(join(neutralDist, `${name}.js`), 'utf8'),
      `dist/${name}.js drifted from the neutral build`,
    );
  }
  // The bundled entry's source of truth: a fork here would still fork the
  // runtime, so the pristine bytes are guarded even though dist/ is bundled.
  assert.equal(
    readFileSync(join(root, 'vendor', 'neutral', 'broker_main.js'), 'utf8'),
    readFileSync(join(neutralDist, 'broker_main.js'), 'utf8'),
    'vendor/neutral/broker_main.js drifted from the neutral build',
  );
  assert.equal(
    readFileSync(join(root, 'src', 'broker_main.d.ts'), 'utf8'),
    readFileSync(join(neutralDist, 'broker_main.d.ts'), 'utf8'),
    'src/broker_main.d.ts shim drifted from the neutral build',
  );
});

test('this package no longer owns the moved sources', () => {
  // The slimming contract: ownership moved to aeval/control; a regression
  // that re-adds a source file here would fork the broker cluster.
  for (const name of NEUTRAL_MODULES) {
    assert.equal(
      existsSync(join(root, 'src', `${name}.ts`)),
      false,
      `src/${name}.ts must not exist here — the neutral package owns it`,
    );
  }
});

test('vendor/neutral carries the whole runtime a standalone clone needs', () => {
  // Without a sibling checkout, vendor/neutral/ is the only source that
  // composes dist/. A missing file surfaces as ERR_MODULE_NOT_FOUND deep
  // inside the selfcheck cases, which is the wrong place to learn about it —
  // so the completeness contract is asserted here instead.
  const vendor = join(root, 'vendor', 'neutral');
  assert.ok(
    existsSync(vendor),
    'vendor/neutral/ must exist: it is what keeps a bare clone buildable',
  );
  for (const name of [...NEUTRAL_MODULES, 'upstream_responses']) {
    assert.ok(
      existsSync(join(vendor, `${name}.js`)),
      `vendor/neutral/${name}.js is missing, so dist/${name}.js cannot be composed`,
    );
    assert.ok(
      existsSync(join(vendor, `${name}.d.ts`)),
      `vendor/neutral/${name}.d.ts is missing, so dist/${name}.d.ts cannot be composed`,
    );
  }
});
