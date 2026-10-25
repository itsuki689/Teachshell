import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('dist-electron', { recursive: true });
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
