/** Install only our verified application; keep a recoverable bundle and never touch user data. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = '/Applications/Teachshell.app';
const register =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const source = path.resolve(
  process.argv[2] ??
    path.join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Teachshell.app'),
);
if (process.platform !== 'darwin') throw new Error('macOS installation requires macOS');
async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
async function hash(file) {
  const h = createHash('sha256');
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest('hex');
}
async function appID(bundle) {
  return (
    await exec('/usr/bin/plutil', [
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(bundle, 'Contents/Info.plist'),
    ])
  ).stdout.trim();
}
async function verify(bundle) {
  if ((await fs.lstat(bundle)).isSymbolicLink())
    throw new Error('Refusing symbolic application bundle');
  if ((await appID(bundle)) !== 'com.teachshelf.desktop')
    throw new Error('Refusing to replace an unrelated application');
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
}
async function running(terminate = false) {
  const script = `ObjC.import('AppKit'); const result=[]; const apps=$.NSWorkspace.sharedWorkspace.runningApplications; for(let i=0;i<apps.count;i++){const app=apps.objectAtIndex(i);let p;try{p=ObjC.unwrap(app.bundleURL.path);}catch{}if(p===${JSON.stringify(target)}){result.push(Number(app.processIdentifier));${terminate ? 'app.terminate;' : ''}}} JSON.stringify(result);`;
  return JSON.parse(
    (await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script])).stdout.trim() || '[]',
  );
}
async function quitNormally() {
  const ids = await running(true);
  if (!ids.length) return;
  console.log('Requested normal quit; waiting for saved work and shutdown.');
  for (let i = 0; i < 60; i++) {
    if (!(await running()).length) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    'Teachshell has not quit. Resolve its save/close prompt; the installed bundle was not replaced.',
  );
}
await verify(source);
const expected = await hash(path.join(source, 'Contents/Resources/app.asar'));
const stage = '/Applications/.Teachshell-install-' + randomUUID() + '.app';
let backup;
let installed = false;
try {
  if (await exists(target)) await verify(target);
  await exec('/usr/bin/ditto', [source, stage]);
  await verify(stage);
  if ((await hash(path.join(stage, 'Contents/Resources/app.asar'))) !== expected)
    throw new Error('Application staging checksum mismatch');
  await quitNormally();
  if (await exists(target)) {
    const backups = '/Applications/.Teachshell-backups';
    if (await exists(backups)) {
      const stat = await fs.lstat(backups);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('Unsafe application backup directory');
    } else await fs.mkdir(backups, { mode: 0o700 });
    const folder = path.join(
      backups,
      new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID(),
    );
    await fs.mkdir(folder, { mode: 0o700 });
    backup = path.join(folder, 'Teachshell.app');
    await fs.rename(target, backup);
  }
  await fs.rename(stage, target);
  installed = true;
  await verify(target);
  if ((await hash(path.join(target, 'Contents/Resources/app.asar'))) !== expected)
    throw new Error('Installed application checksum mismatch');
  await exec(register, ['-f', '-R', target]);
  await exec('/usr/bin/open', ['-a', target]);
  let pids = [];
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    pids = await running();
    if (pids.length) break;
  }
  if (!pids.length) throw new Error('The newly installed application did not start');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  if (!(await running()).length) throw new Error('The installed application exited during startup');
  const receipt = {
    installed: target,
    source,
    backup: backup ?? null,
    asarSHA256: expected,
    pids,
    verifiedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.join(root, 'release'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'release/installed-macos.json'),
    JSON.stringify(receipt, null, 2) + '\n',
  );
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  if (installed) {
    await quitNormally();
    const failed = '/Applications/.Teachshell-failed-' + randomUUID() + '.app';
    await fs.rename(target, failed);
    console.error('Preserved unsuccessful new bundle at ' + failed);
  }
  if (backup && (await exists(backup)) && !(await exists(target))) {
    await fs.rename(backup, target);
    await exec(register, ['-f', '-R', target]);
    await exec('/usr/bin/open', ['-a', target]);
    console.error('Restored the previous application.');
  }
  throw error;
} finally {
  if (await exists(stage)) await fs.rm(stage, { recursive: true });
}
