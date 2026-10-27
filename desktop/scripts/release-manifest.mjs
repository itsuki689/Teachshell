/** The release must contain exactly one verified artifact set for each supported architecture. */
export const releaseTargets = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'win32', arch: 'x64' },
];
export function expectedReleaseFiles(version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be x.y.z');
  if (!releaseTargets.some((t) => t.platform === platform && t.arch === arch))
    throw new Error('Unsupported release target');
  const stem = `Teachshell-${version}-${platform === 'darwin' ? 'mac' : 'win'}-${arch}`;
  return platform === 'darwin' ? [stem + '.dmg', stem + '.zip'] : [stem + '.exe'];
}
export function mergeReleaseManifests(manifests, version, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release commit');
  if (manifests.length !== releaseTargets.length) throw new Error('Incomplete release target set');
  const seen = new Set();
  for (const m of manifests) {
    if (m.version !== version || m.commit !== commit || m.verified !== true)
      throw new Error('Unverified or mismatched release manifest');
    const target = `${m.platform}-${m.arch}`;
    if (seen.has(target)) throw new Error('Duplicate release target');
    seen.add(target);
    const names = expectedReleaseFiles(version, m.platform, m.arch).sort();
    if (JSON.stringify(m.artifacts.map((a) => a.name).sort()) !== JSON.stringify(names))
      throw new Error('Missing or unexpected release assets');
    if (
      m.artifacts.some(
        (a) => !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.size) || a.size <= 0,
      )
    )
      throw new Error('Invalid artifact checksum or size');
  }
  return {
    version,
    commit,
    targets: [...manifests].sort((a, b) =>
      `${a.platform}-${a.arch}`.localeCompare(`${b.platform}-${b.arch}`),
    ),
  };
}
