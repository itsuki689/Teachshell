import test from 'node:test';
import assert from 'node:assert/strict';
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
test('release has distinct Windows x64, Mac ARM and Intel assets', () => {
  const merged = mergeReleaseManifests(manifests(), version, commit);
  assert.equal(new Set(merged.targets.flatMap((t) => t.artifacts.map((a) => a.name))).size, 5);
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
