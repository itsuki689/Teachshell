import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  expectedReleaseFiles,
  mergeReleaseManifests,
  releaseTargets,
} from '../scripts/release-manifest.mjs';
const version = '0.3.8',
  commit = 'a'.repeat(40);
const manifests = () =>
  releaseTargets.map((t) => ({
    ...t,
    version,
    commit,
    verified: true,
    artifacts: expectedReleaseFiles(version, t.platform, t.arch).map((name) => ({
      name,
      size: 100,
      sha256: 'b'.repeat(64),
    })),
  }));
test('release contains only Windows x64 and Apple Silicon Mac installers', () => {
  const merged = mergeReleaseManifests(manifests(), version, commit);
  assert.deepEqual(merged.targets.flatMap((t) => t.artifacts.map((a) => a.name)).sort(), [
    'Teachshell-0.3.8-mac-arm64.dmg',
    'Teachshell-0.3.8-mac-arm64.zip',
    'Teachshell-0.3.8-win-x64.exe',
  ]);
  assert.throws(() => expectedReleaseFiles(version, 'darwin', 'x64'), /Unsupported release target/);
  const intel = manifests();
  intel[0].arch = 'x64';
  assert.throws(() => mergeReleaseManifests(intel, version, commit), /Unsupported release target/);
});
test('macOS packaging rejects Intel and universal targets before accessing the helper', async () => {
  const require = createRequire(import.meta.url);
  const beforePack = require('../scripts/before-pack.cjs');
  const { Arch } = require('builder-util');
  for (const arch of [Arch.x64, Arch.universal])
    await assert.rejects(
      () => beforePack({ electronPlatformName: 'darwin', arch }),
      /Apple Silicon/,
    );
  await beforePack({ electronPlatformName: 'win32', arch: Arch.x64 });
});
test('publication refuses missing, duplicated, stale or unverified targets', () => {
  assert.throws(() => mergeReleaseManifests(manifests().slice(1), version, commit));
  const duplicates = manifests();
  duplicates[1] = duplicates[0];
  assert.throws(() => mergeReleaseManifests(duplicates, version, commit));
  for (const patch of [
    { version: '0.3.7' },
    { commit: 'c'.repeat(40) },
    { verified: false },
    { platform: 'linux' },
  ]) {
    const input = manifests();
    Object.assign(input[0], patch);
    assert.throws(() => mergeReleaseManifests(input, version, commit));
  }
});
test('publication refuses unsafe names, empty installers and invalid digests', () => {
  for (const patch of [{ name: '../other.exe' }, { size: 0 }, { sha256: 'invalid' }]) {
    const input = manifests();
    Object.assign(input[0].artifacts[0], patch);
    assert.throws(() => mergeReleaseManifests(input, version, commit));
  }
  for (const version of ['../0.3.8', '0.3.8-rc', 'latest'])
    assert.throws(() => expectedReleaseFiles(version, 'darwin', 'arm64'));
});
