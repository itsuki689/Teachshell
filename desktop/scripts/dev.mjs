import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import electron from 'electron';
await build({
  entryPoints: ['electron/main/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: ['electron'],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload/index.ts'],
  bundle: true,
  platform: 'node',
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
  format: 'cjs',
  outfile: 'dist-electron/mcp-stdio.cjs',
});
const server = await createServer();
await server.listen();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, TEACHSHELF_DEV_URL: 'http://127.0.0.1:5173' },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
