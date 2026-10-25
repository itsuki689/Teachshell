import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const product = metadata.build.productName;
const candidates =
  process.platform === 'darwin'
    ? [
        `release/mac-${process.arch}/${product}.app/Contents/MacOS/${product}`,
        `release/mac/${product}.app/Contents/MacOS/${product}`,
      ]
    : process.platform === 'win32'
      ? [
          `release/win-unpacked/${product}.exe`,
          `release/win-${process.arch}-unpacked/${product}.exe`,
        ]
      : [
          `release/linux-unpacked/${metadata.name}`,
          `release/linux-${process.arch}-unpacked/${metadata.name}`,
        ];
let executable;
for (const relative of candidates) {
  const candidate = path.join(root, relative);
  try {
    await fs.access(candidate);
    executable = candidate;
    break;
  } catch {}
}
if (!executable)
  throw new Error('Build the installer for this platform before testing the packaged application.');
const evidence = process.env.TEACHSHELF_SCREENSHOT_DIR;
const child = spawn(process.execPath, [path.join(root, 'tests/electron.e2e.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    TEACHSHELF_EXECUTABLE: executable,
    ...(evidence ? { TEACHSHELF_SCREENSHOT_DIR: path.join(evidence, 'packaged') } : {}),
  },
});
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
