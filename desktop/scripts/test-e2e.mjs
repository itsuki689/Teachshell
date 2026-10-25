import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = [
  'electron.e2e.mjs',
  'website-batch.e2e.mjs',
  'schedule-drag.e2e.mjs',
  'toolbar.e2e.mjs',
  'website-login-ui.e2e.mjs',
  'website-background.e2e.mjs',
  'website-review-live.e2e.mjs',
  'workspace-sync.e2e.mjs',
  'e2e-component-sync.mjs',
  'e2e-ui-parity.mjs',
  'page-layout.e2e.mjs',
  'website-context.e2e.mjs',
];
// The transport test bundles the source into a separate minimal Electron host.
// The other suites exercise the actual installed app when an executable is set.
if (!process.env.TEACHSHELF_EXECUTABLE)
  tests.push('website-browser.e2e.mjs', 'website-login.e2e.mjs');
for (const test of tests) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'tests', test)], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
  if (code !== 0) {
    process.exitCode = Number(code);
    break;
  }
}
