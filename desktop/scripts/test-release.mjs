import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
const executable = path.resolve(
  process.platform === 'darwin'
    ? `release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Teachshell.app/Contents/MacOS/Teachshell`
    : 'release/win-unpacked/Teachshell.exe',
);
await fs.access(executable);
for (const test of [
  'schedule-workspace.e2e.mjs',
  'schedule-interactions.e2e.mjs',
  'page-refresh.e2e.mjs',
  'toolbar-feedback.e2e.mjs',
  'website-login-ui.e2e.mjs',
]) {
  console.log('RELEASE SUITE', test);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', path.resolve('tests', test)],
      {
        stdio: 'inherit',
        env: { ...process.env, TEACHSHELF_EXECUTABLE: executable },
        timeout: 300_000,
        killSignal: 'SIGKILL',
      },
    );
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) console.error(`${test} terminated (${signal}); suite limit is five minutes`);
      resolve(code ?? 1);
    });
  });
  if (code !== 0) process.exit(code);
}
