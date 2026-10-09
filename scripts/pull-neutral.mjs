// Compose this package's deployment unit from the neutral control package
// (aeval/control — source of truth for the broker cluster).
//
//   neutral dist/*.d.ts -> src/      type shims: the remaining sources keep
//                                    importing './config.js' unchanged
//   neutral dist/*.js   -> dist/     deployment composition: the in-DSH plugin
//                                    is uploaded as flat dist/*.js with
//                                    relative imports only, so the neutral
//                                    runtime must sit next to our own output
//                  and -> .test-dist/src/  (when present) so tests that
//                                    import '../src/<moved>.js' run against
//                                    the real neutral runtime, byte-unchanged
//
// Two sources, in this order:
//
//   1. $AEVAL_CONTROL_DIST, else the sibling aeval/control checkout. This is
//      the live build, and the only source that refreshes the committed type
//      shims in src/.
//   2. vendor/neutral/ — the runtime and declarations committed into this
//      repository, so a standalone clone still composes a complete dist/.
//
// Neither source existing is a hard error rather than a no-op: `dist/` is
// gitignored, so skipping left the neutral runtime absent and every consumer
// of `./config.js` died at import time with nothing pointing at the cause.
// The freshness guard in test/neutral-shims.test.ts re-verifies against the
// sibling when it is present; the vendored copy is what makes a bare clone
// build and test green.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sibling = process.env.AEVAL_CONTROL_DIST
  ?? join(root, '..', 'aeval', 'control', 'dist');
const vendored = join(root, 'vendor', 'neutral');

const fromSibling = existsSync(sibling);
const source = fromSibling ? sibling : (existsSync(vendored) ? vendored : null);

if (source === null) {
  throw new Error(
    `[pull-neutral] no neutral runtime available — neither ${sibling} nor ` +
    `${vendored} exists.\n` +
    '  run "npm run build" in aeval/control, or restore vendor/neutral/ from git',
  );
}

const jsDest = join(root, 'dist');
const dtsDest = join(root, 'src');
const testDest = join(root, '.test-dist', 'src');
const intoTest = existsSync(join(root, '.test-dist'));
let js = 0;
let dts = 0;
for (const name of readdirSync(source)) {
  if (name.endsWith('.js')) {
    mkdirSync(jsDest, { recursive: true });
    cpSync(join(source, name), join(jsDest, name));
    js += 1;
    if (intoTest) {
      mkdirSync(testDest, { recursive: true });
      cpSync(join(source, name), join(testDest, name));
    }
  } else if (name.endsWith('.d.ts')) {
    // Only the sibling is allowed to rewrite the committed shims: the vendored
    // copy must never overwrite src/, or a stale vendor snapshot would silently
    // masquerade as the source of truth.
    if (fromSibling) cpSync(join(source, name), join(dtsDest, name));
    // keep dist/ declarations fresh too (tsc never re-emits .d.ts inputs,
    // so a stale one from a pre-slimming build would otherwise linger)
    cpSync(join(source, name), join(jsDest, name));
    dts += 1;
  }
}
if (js === 0 || dts === 0) {
  throw new Error(
    `[pull-neutral] ${source} has no build output (js=${js}, d.ts=${dts}) — ` +
    (fromSibling
      ? 'run "npm run build" in aeval/control first'
      : 'vendor/neutral/ is incomplete; restore it from git'),
  );
}

// Opt-in maintenance path: `npm run vendor:neutral` mirrors the live sibling
// build into vendor/neutral/, so the standalone fallback cannot rot quietly
// when aeval/control changes. Refused without a sibling — the vendored copy
// must never be its own source of truth.
if (process.argv.includes('--refresh-vendor')) {
  if (!fromSibling) {
    throw new Error(
      `[pull-neutral] --refresh-vendor needs the sibling build at ${sibling}; ` +
      'refusing to copy the vendored fallback back over itself',
    );
  }
  mkdirSync(vendored, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(sibling)) {
    if (name.endsWith('.js') || name.endsWith('.d.ts')) {
      cpSync(join(sibling, name), join(vendored, name));
      copied += 1;
    }
  }
  console.log(`[pull-neutral] refreshed ${copied} files in vendor/neutral/`);
}
console.log(`[pull-neutral] composed ${js} runtime files into dist/` +
  (intoTest ? ' and .test-dist/src/' : '') + `, ${dts} type declarations` +
  (fromSibling
    ? ` from the sibling checkout (shims refreshed in src/)`
    : ` from vendor/neutral/ (no sibling checkout; src/ shims left as committed)`));
