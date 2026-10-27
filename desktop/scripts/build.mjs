import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
await fs.mkdir('dist-electron', { recursive: true });
// Ship an ARM64 Keychain bridge for supported Apple Silicon Macs.
// End users need no Swift toolchain. Do not bypass runtime link checks.
if (process.platform === 'darwin') {
  if (process.arch !== 'arm64')
    throw new Error(
      'macOS builds require Apple Silicon and arm64 Node.js; Intel Mac is no longer supported.',
    );
  const nativeBuild = await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-keychain-build-'));
  try {
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-swift-version',
        '5',
        '-O',
        '-target',
        'arm64-apple-macos12.0',
        '-module-cache-path',
        path.join(nativeBuild, 'cache'),
        'electron/services/website/native/TeachingSessionKeychain.swift',
        '-o',
        'dist-electron/teaching-session-keychain',
      ],
      { stdio: 'inherit' },
    );
    execFileSync('/usr/bin/codesign', [
      '--force',
      '--sign',
      '-',
      '--identifier',
      'com.teachshelf.desktop.teaching-session-keychain',
      'dist-electron/teaching-session-keychain',
    ]);
    execFileSync('/usr/bin/codesign', [
      '--verify',
      '--strict',
      'dist-electron/teaching-session-keychain',
    ]);
  } finally {
    await fs.rm(nativeBuild, { recursive: true, force: true });
  }
}
const commit =
  process.env.TEACHSHELL_BUILD_COMMIT ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid release source revision');
const packageInfo = JSON.parse(await fs.readFile('package.json', 'utf8'));
await fs.writeFile(
  'dist-electron/release-info.json',
  JSON.stringify(
    { version: packageInfo.version, commit, builtAt: new Date().toISOString() },
    null,
    2,
  ) + '\n',
);
await build({
  entryPoints: ['electron/main/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: ['electron'],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
});
await fs.cp('electron/services/website/scripts', 'dist-electron/website-scripts', {
  recursive: true,
});

await build({
  entryPoints: ['electron/services/mcp/stdio-cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist-electron/mcp-stdio.cjs',
});
