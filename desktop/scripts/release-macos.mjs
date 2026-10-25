/** Build a committed snapshot so parallel unfinished edits never enter an installed Release. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile),
  desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  repo = path.dirname(desktop);
if (process.platform !== 'darwin') throw new Error('This release command targets macOS');
const commit = (await exec('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-release-'));
const output = path.join(desktop, 'release'),
  snapshot = path.join(temporary, 'desktop');
async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const p = spawn(command, args, {
      cwd: snapshot,
      stdio: 'inherit',
      env: { ...process.env, TEACHSHELL_BUILD_COMMIT: commit },
      ...options,
    });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(command + ' exited ' + code)),
    );
  });
}
try {
  await exec(
    'git',
    [
      'archive',
      '--format=tar',
      '--output=' + path.join(temporary, 'source.tar'),
      commit,
      'desktop',
    ],
    { cwd: repo },
  );
  await exec('/usr/bin/tar', ['-xf', path.join(temporary, 'source.tar'), '-C', temporary]);
  await fs.symlink(path.join(desktop, 'node_modules'), path.join(snapshot, 'node_modules'), 'dir');
  console.log('Building committed Release ' + commit);
  await run('npm', ['run', 'build']);
  await run(process.execPath, [
    path.join(desktop, 'node_modules/electron-builder/out/cli/cli.js'),
    '--mac',
    '--dir',
    '--' + process.arch,
    '--publish',
    'never',
    '--config.directories.output=' + output,
  ]);
  const metadata = JSON.parse(await fs.readFile(path.join(snapshot, 'package.json'), 'utf8'));
  const built = path.join(
    output,
    process.arch === 'arm64' ? 'mac-arm64' : 'mac',
    metadata.build.productName + '.app',
  );
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', built]);
  const asar = await import(path.join(desktop, 'node_modules/@electron/asar/lib/asar.js'));
  const release = JSON.parse(
    asar
      .extractFile(
        path.join(built, 'Contents/Resources/app.asar'),
        'dist-electron/release-info.json',
      )
      .toString('utf8'),
  );
  if (release.commit !== commit || release.version !== metadata.version)
    throw new Error('Release metadata does not match the committed build');
  await run(process.execPath, [path.join(desktop, 'scripts/install-macos.mjs'), built], {
    cwd: desktop,
  });
  console.log(
    'Installed and registered committed Teachshell Release ' +
      release.version +
      ' (' +
      commit.slice(0, 7) +
      ')',
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
