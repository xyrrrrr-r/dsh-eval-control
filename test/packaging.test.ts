/**
 * The published bundle surface: what the marketplace's static review reads
 * (package.json + the patch file it names) and what a profile install loads.
 *
 * These assertions are deliberately about FILES, not behaviour: a missing
 * declaration or a patch that is not committed/exported is exactly the class
 * of failure the catalog gate rejects, and it is invisible to every other
 * test in this suite.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Compiled tests live in `.test-dist/test/`, so the repository root is two
// levels up (same convention as the other suites).
const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  files: string[];
  exports: Record<string, unknown>;
  bin: Record<string, string>;
  icon: string;
  dsh: { bundle?: { patch?: string }; client?: { platform?: string } };
  dependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test('the manifest declares an installable dsh bundle whose patch is committed', () => {
  assert.equal(manifest.dsh.bundle?.patch, './cordis.patch.yml');
  const patch = join(root, 'cordis.patch.yml');
  assert.ok(existsSync(patch), 'cordis.patch.yml must exist in the repository');
  const text = readFileSync(patch, 'utf8');
  assert.match(text, /^- insert:/m, 'the patch must be a Loader insert list');
  assert.match(text, /id: aeval-broker-transport/);
  assert.match(text, /name: '\.\/dist\/sandbox_entry\.js'/);
  assert.ok(text.trim().length > 0);
});

test('every published asset is inside the files whitelist and exists', () => {
  for (const required of ['client', 'locale', 'icon.svg', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(required), `files must publish ${required}`);
  }
  for (const entry of ['client/client.js', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'cordis.patch.yml']) {
    assert.ok(existsSync(join(root, entry)), `${entry} must exist`);
  }
  // The whole point of the whitelist: nothing referenced by the bundle may
  // live outside it, or the installed package cannot load it.
  for (const entry of manifest.files) {
    assert.ok(existsSync(join(root, entry)), `files entry ${entry} must exist`);
  }
});

test('subpaths the bundle needs are exported', () => {
  for (const subpath of ['.', './client', './package.json', './cordis.patch.yml', './locale/*.json']) {
    assert.ok(subpath in manifest.exports, `exports must expose ${subpath}`);
  }
  // A client half is only loaded when the manifest declares its platform.
  assert.equal(manifest.dsh.client?.platform, 'web');
});

test('the icon and locales satisfy the display-metadata contract', () => {
  const icon = join(root, manifest.icon);
  assert.ok(existsSync(icon), 'the declared icon must exist');
  assert.ok(statSync(icon).size <= 256 * 1024, 'icons are limited to 256 KiB');
  assert.match(manifest.icon, /^\.\//, 'the icon path is manifest-relative');

  for (const language of ['en', 'zh']) {
    const dictionary = JSON.parse(readFileSync(join(root, 'locale', `${language}.json`), 'utf8')) as {
      meta?: { title?: string; description?: string };
    };
    assert.ok(dictionary.meta?.title, `${language} must carry meta.title`);
    assert.ok(dictionary.meta?.description, `${language} must carry meta.description`);
  }
});

test('runtime peers are ranged while build-time pins stay exact', () => {
  const harness = (deps: Record<string, string>) =>
    Object.keys(deps).filter((name) => name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/dsh-ptc-runtime');

  // The published face range-binds the host's own Harness packages so a
  // profile reuses one copy; the exact pins live in devDependencies, which
  // never reach a consumer.
  assert.deepEqual(harness(manifest.dependencies), [], 'Harness packages must not be install-time dependencies');
  assert.ok(Object.keys(manifest.peerDependencies).length > 0);
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.ok(/[\^~]|>=/.test(range), `${name} must carry a version range, not a pin`);
  }
  for (const name of harness(manifest.peerDependencies)) {
    assert.ok(name in manifest.devDependencies, `${name} must keep an exact build-time pin`);
  }
  for (const range of Object.values(manifest.devDependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+/, 'build-time pins must stay exact');
  }
  // The gateway composes the deployment from these peers; a non-@deepseek
  // library the plugin imports directly stays an ordinary dependency.
  assert.equal(manifest.dependencies['@agentclientprotocol/sdk'], '1.4.0');
});

test('the self-check command is built and wired as a bin', () => {
  assert.equal(manifest.bin['aeval-dsh-control-selfcheck'], 'dist/selfcheck.js');
  assert.ok(existsSync(join(root, 'dist', 'selfcheck.js')), 'the build must emit dist/selfcheck.js');
});