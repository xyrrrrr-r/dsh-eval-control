#!/usr/bin/env node
/**
 * Make the two entries aeval runs as *their own process* self-contained.
 *
 * Why this exists
 * ---------------
 * aeval runs `dist/broker_main.js` (the model broker) and `dist/session_reader.js`
 * (the session reader) as bare `node <file>` subprocesses. Those two therefore
 * have to resolve `@deepseek-ai/*` on their own. But this package declares those
 * packages as *peers*, because the in-process plugin (`dist/index.js`, loaded by
 * the DSH host through `cordis.patch.yml`) must share the host's instances —
 * `SessionId` and `scopeOf` are runtime values, so a second copy would take the
 * plugin out of the host's realm.
 *
 * A market install (`dsh plugin add`, pnpm) only installs `dependencies`, so the
 * peer copies are absent and the subprocesses died with
 * `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-llm'`.
 *
 * The fix keeps both properties at once: bundle the *subprocess* entries with
 * their imports inlined (they are process-isolated, so a private copy is exactly
 * right), and leave every file the host loads in-process untouched so it keeps
 * resolving the host's peer instances.
 *
 * Order matters: `scripts/pull-neutral.mjs` composes dist/ and `tsc` compiles
 * src/; this runs last and only rewrites the two entries named below.
 */
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Only these two are executed as their own process by aeval. */
const SUBPROCESS_ENTRIES = ['broker_main.js', 'session_reader.js'];

/** Files the DSH host loads in-process must stay plain (peer-resolving). */
const IN_PROCESS_ENTRIES = ['index.js', 'sandbox_entry.js'];

const bareSpecifier = /(?:from|import)\s*\(?\s*['"]([^'"\s]+)['"]/g;

function externalBareImports(file) {
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  for (const [, spec] of text.matchAll(bareSpecifier)) {
    if (spec.startsWith('.') || spec.startsWith('node:') || spec.startsWith('/')) continue;
    if (builtinModules.includes(spec)) continue;
    found.add(spec);
  }
  return [...found].sort();
}

for (const name of SUBPROCESS_ENTRIES) {
  const entry = join(root, 'dist', name);
  const before = statSync(entry).size;
  const tmp = `${entry}.bundling`;
  await build({
    entryPoints: [entry],
    outfile: tmp,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'inline',
    logLevel: 'warning',
  });
  renameSync(tmp, entry);
  const after = statSync(entry).size;
  const leftovers = externalBareImports(entry);
  if (leftovers.length > 0) {
    throw new Error(
      `dist/${name} is not self-contained after bundling; still imports: ${leftovers.join(', ')}`,
    );
  }
  const hashbang = readFileSync(entry, 'utf8').startsWith('#!') ? 'kept' : 'MISSING';
  console.log(
    `[bundle-standalone] dist/${name}: ${(before / 1024).toFixed(1)} KiB -> ` +
      `${(after / 1024).toFixed(1)} KiB, self-contained, hashbang ${hashbang}`,
  );
}

for (const name of IN_PROCESS_ENTRIES) {
  const abs = join(root, 'dist', name);
  const deps = externalBareImports(abs);
  if (deps.length === 0) {
    throw new Error(
      `dist/${name} no longer imports any @deepseek-ai peer — the in-process entry ` +
        'was expected to keep resolving the host copies',
    );
  }
  console.log(`[bundle-standalone] dist/${name}: left plain, peers ${deps.join(', ')}`);
}
