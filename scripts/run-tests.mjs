// Standalone-aware test runner.
//
// With the sibling checkout present (../aeval/control/dist, or the
// AEVAL_CONTROL_DIST override), `npm run pull-neutral` has already composed
// the moved runtime modules (config.js, broker_main.js, …) into
// .test-dist/src/ and every compiled test file can load — we run them all,
// and any missing import target is a real failure.
//
// Without the sibling (standalone clone), test files whose compiled import
// closure reaches a moved runtime module cannot even load: the
// ERR_MODULE_NOT_FOUND happens at import time, before any in-file skip could
// run. So we detect those files statically — walk their relative imports and
// look for .js targets that do not exist on disk — and exclude them with a
// loud per-file notice instead of letting them crash the whole run.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const neutral = process.env.AEVAL_CONTROL_DIST
  ?? join(root, '..', 'aeval', 'control', 'dist');
const sibling = existsSync(neutral);

const testDir = join(root, '.test-dist', 'test');
if (!existsSync(testDir)) {
  console.error('[run-tests] .test-dist/test not found — run "npm test" (it compiles first)');
  process.exit(1);
}
const files = readdirSync(testDir)
  .filter((n) => n.endsWith('.test.js'))
  .map((n) => join(testDir, n))
  .sort();

// Static scan of the compiled import closure: does any relative import
// (static `from '…'` or dynamic `import('…')`) resolve to a missing file?
// Type-only imports are erased by tsc and never appear here.
function reachesMissingRuntime(file, seen = new Set([file])) {
  const code = readFileSync(file, 'utf8');
  for (const m of code.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) return true;
    if (target.endsWith('.js') && !seen.has(target)) {
      seen.add(target);
      if (reachesMissingRuntime(target, seen)) return true;
    }
  }
  return false;
}

let run = files;
if (!sibling) {
  run = [];
  for (const f of files) {
    if (reachesMissingRuntime(f)) {
      console.log(`[run-tests] SKIP ${basename(f)} — 需要组合的中性运行时` +
        '（同级 aeval/control/dist 不在场；standalone clone）');
    } else {
      run.push(f);
    }
  }
}
if (run.length === 0) {
  console.error('[run-tests] no runnable test files left');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...run], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(result.status ?? 1);
