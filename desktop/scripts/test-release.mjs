import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
const executable = path.resolve(
  process.platform === 'darwin'
    ? `release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Teachshell.app/Contents/MacOS/Teachshell`
    : 'release/win-unpacked/Teachshell.exe',
);
await fs.access(executable);
for (const test of ['schedule-workspace.e2e.mjs', 'schedule-interactions.e2e.mjs']) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', path.resolve('tests', test)],
      {
        stdio: 'inherit',
        env: { ...process.env, TEACHSHELF_EXECUTABLE: executable },
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (code !== 0) process.exit(code);
}
