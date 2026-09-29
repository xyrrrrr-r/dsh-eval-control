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
// Without the sibling checkout this is a no-op with a loud message: the
// committed shims and composed dist stand as the record (standalone clone
// stays buildable); the freshness test re-verifies when the sibling exists.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const neutral = process.env.AEVAL_CONTROL_DIST
  ?? join(root, '..', 'aeval', 'control', 'dist');

if (!existsSync(neutral)) {
  console.log(`[pull-neutral] ${neutral} not found — keeping committed shims/dist`);
  process.exit(0);
}

const jsDest = join(root, 'dist');
const dtsDest = join(root, 'src');
const testDest = join(root, '.test-dist', 'src');
const intoTest = existsSync(join(root, '.test-dist'));
let js = 0;
let dts = 0;
for (const name of readdirSync(neutral)) {
  if (name.endsWith('.js')) {
    mkdirSync(jsDest, { recursive: true });
    cpSync(join(neutral, name), join(jsDest, name));
    js += 1;
    if (intoTest) {
      mkdirSync(testDest, { recursive: true });
      cpSync(join(neutral, name), join(testDest, name));
    }
  } else if (name.endsWith('.d.ts')) {
    cpSync(join(neutral, name), join(dtsDest, name));
    // keep dist/ declarations fresh too (tsc never re-emits .d.ts inputs,
    // so a stale one from a pre-slimming build would otherwise linger)
    cpSync(join(neutral, name), join(jsDest, name));
    dts += 1;
  }
}
if (js === 0 || dts === 0) {
  throw new Error(
    `[pull-neutral] ${neutral} has no build output (js=${js}, d.ts=${dts}) — ` +
    'run "npm run build" in aeval/control first',
  );
}
console.log(`[pull-neutral] composed ${js} runtime files into dist/` +
  (intoTest ? ' and .test-dist/src/' : '') + `, ${dts} type shims into src/`);
