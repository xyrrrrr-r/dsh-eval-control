import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const aevalRoot = resolve(process.argv[2] ?? join(root, '..', 'aeval'));
const revision = process.argv[3];
if (!revision || !/^[0-9a-f]{7,40}$/i.test(revision)) {
  console.error('Usage: node scripts/sync-trajectory-fixtures.mjs <aeval-path> <aeval-commit>');
  process.exit(2);
}

const source = join(aevalRoot, 'tests/fixtures/trajectory_contract/v1');
const target = join(root, 'test/fixtures/trajectory_contract/v1');
if (!existsSync(join(source, 'manifest.json'))) throw new Error(`aeval fixture manifest not found: ${source}`);
rmSync(target, { recursive: true, force: true });
mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
const manifestPath = join(target, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.aevalRevision = revision;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Synced aeval trajectory fixtures at ${revision} into ${target}`);
