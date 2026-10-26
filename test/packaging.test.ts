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
import { builtinModules } from 'node:module';
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

test('runtime peers range over the verified DSH host line', () => {
  const harness = (deps: Record<string, string>) =>
    Object.keys(deps).filter((name) => name.startsWith('@deepseek-ai/') && name !== '@deepseek-ai/dsh-ptc-runtime');

  // The published face range-binds the host's own Harness packages so a
  // profile reuses one copy. An own `engines.dsh` would quiet the host's
  // install gate but not the marketplace filter, which intersects every peer,
  // so the contract peers must cover each host release this plugin claims.
  // The exact pins live in devDependencies, which never reach a consumer.
  assert.deepEqual(harness(manifest.dependencies), [], 'Harness packages must not be install-time dependencies');
  assert.ok(Object.keys(manifest.peerDependencies).length > 0);
  // Verified on both releases of the line: 0.2.0-rc.2 and 0.2.1-rc.2.
  const verifiedHostLine = '>=0.2.0-rc.2 <0.3.0-0';
  for (const name of [
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-experimental-agent-team',
    '@deepseek-ai/dsh-llm-retry',
    '@deepseek-ai/dsh-session-projection',
  ]) {
    assert.equal(manifest.peerDependencies[name], verifiedHostLine,
      `${name} carries event/projection contracts and must cover every verified host release`);
  }
  for (const [name, range] of Object.entries(manifest.peerDependencies)) {
    assert.ok(/[\^~]|>=/.test(range), `${name} must carry a compatibility range`);
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

test('the subprocess entries aeval spawns resolve nothing at runtime', () => {
  // aeval runs these two as their own process (`node <entry> [args]`), so they
  // cannot borrow the DSH host's instances. A market install only brings
  // `dependencies`, which is why a peer-provided copy is absent there and the
  // entries died with ERR_MODULE_NOT_FOUND: Cannot find package
  // '@deepseek-ai/dsh-llm'. The build inlines their imports instead
  // (scripts/bundle-standalone.mjs) — this is the regression guard for that.
  const bare = /(?:from|import)\s*\(?\s*['"]([^'"\s]+)['"]/g;
  for (const entry of ['broker_main.js', 'session_reader.js']) {
    const text = readFileSync(join(root, 'dist', entry), 'utf8');
    const external = [...text.matchAll(bare)]
      .map((match) => match[1] ?? '')
      .filter(
        (spec) =>
          spec !== '' &&
          !spec.startsWith('.') &&
          !spec.startsWith('node:') &&
          !builtinModules.includes(spec),
      );
    assert.deepEqual(
      external,
      [],
      `dist/${entry} must be self-contained: aeval executes it with no module tree around it`,
    );
    assert.ok(text.startsWith('#!'), `dist/${entry} must keep its shebang`);
  }
  // ...and the bundled broker must really carry the neutral runtime, not a stub.
  const neutral = readFileSync(join(root, 'vendor', 'neutral', 'broker_main.js'), 'utf8');
  const bundled = readFileSync(join(root, 'dist', 'broker_main.js'), 'utf8');
  assert.ok(neutral.includes('parseBrokerMainConfig'), 'the vendor copy is the neutral entry');
  assert.ok(
    bundled.includes('parseBrokerMainConfig'),
    'the bundled broker must carry the neutral runtime it was built from',
  );
  assert.ok(
    bundled.length > neutral.length,
    'the bundled broker must be the inlined build, not the pristine copy',
  );
});

test('the in-process entries keep resolving the host peers', () => {
  // The files the DSH host loads through cordis.patch.yml must import the
  // host's own @deepseek-ai instances: SessionId and scopeOf are runtime
  // values, so a private copy would take the plugin out of the host's realm
  // (and the manifest forbids those packages as install-time dependencies).
  for (const [entry, peer] of [
    ['index.js', '@deepseek-ai/dsh-session'],
    ['index.js', '@deepseek-ai/dsh-scope'],
    ['sandbox_entry.js', '@deepseek-ai/schemastery'],
  ] as const) {
    const text = readFileSync(join(root, 'dist', entry), 'utf8');
    assert.ok(
      text.includes(`'${peer}'`),
      `dist/${entry} must keep importing ${peer} so the host instance is reused`,
    );
  }
});
