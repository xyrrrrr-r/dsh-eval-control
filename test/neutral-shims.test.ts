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

// `npm test` runs COMPILED tests from `.test-dist/test/`, so the repository
// root is two levels up. Deriving it as one level above `import.meta.dirname`
// pointed at `.test-dist/`, which made this freshness guard skip forever even
// with the sibling checkout present — a guard that never runs is worse than no
// guard, because it reports as "skipped, by design".
const root = fileURLToPath(new URL('../../', import.meta.url));
const neutralDist = join(root, '..', 'aeval', 'control', 'dist');

test('composed neutral files match the sibling aeval/control build', { skip: !existsSync(neutralDist) ? 'sibling aeval/control/dist not present (standalone clone)' : false }, () => {
  for (const name of NEUTRAL_MODULES) {
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
