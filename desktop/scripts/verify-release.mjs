/** Verify package payloads before upload; only extracts into a disposable directory. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { expectedReleaseFiles } from './release-manifest.mjs';
const require = createRequire(import.meta.url),
  asar = require('@electron/asar');
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js');
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const metadata = JSON.parse(await fs.readFile('package.json', 'utf8'));
const release = JSON.parse(await fs.readFile('dist-electron/release-info.json', 'utf8'));
const commit =
  process.env.TEACHSHELL_BUILD_COMMIT ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(commit, /^[a-f0-9]{40}$/);
assert.equal(release.version, metadata.version);
assert.equal(release.commit, commit);
const filenames = expectedReleaseFiles(metadata.version, platform, arch);
const output = path.resolve('release'),
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'teachshell-package-check-'));
const run = (bin, args) =>
  execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const hash = async (file) => {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
};
// ASAR traverses directory names using the host separator, including on Windows.
const extract = (archive, name) => asar.extractFile(archive, path.normalize(name));
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const seven = await getPath7za();
async function inspect(directory) {
  const mac = platform === 'darwin',
    resources = path.join(directory, mac ? 'Contents/Resources' : 'resources');
  const archive = path.join(resources, 'app.asar');
  assert.deepEqual(JSON.parse(extract(archive, 'dist-electron/release-info.json')), release);
  assert.equal(JSON.parse(extract(archive, 'package.json')).version, metadata.version);
  const files = asar.listPackage(archive).map((n) => n.replaceAll('\\', '/').replace(/^\//, ''));
  assert.ok(
    !files.some((n) => n.endsWith('/teaching-session-keychain')),
    'Native helper must remain outside asar',
  );
  for (const name of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs'])
    assert.equal(digest(extract(archive, name)), await hash(name), name);
  const rendererFiles = files.filter((n) => /^dist\/assets\/.*\.(?:js|css)$/.test(n));
  assert.ok(rendererFiles.length >= 2, 'Missing renderer assets');
  for (const name of rendererFiles)
    assert.equal(digest(extract(archive, name)), await hash(name), name);
  assert.equal(
    await hash(path.join(resources, 'mcp-stdio.cjs')),
    await hash('dist-electron/mcp-stdio.cjs'),
  );
  if (mac) {
    assert.equal(process.platform, 'darwin', 'Verify Mac archives on a Mac');
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', directory]);
    const expectedArch = arch === 'x64' ? 'x86_64' : 'arm64';
    for (const file of [
      'Contents/MacOS/Teachshell',
      'Contents/Resources/teaching-session-keychain',
    ]) {
      assert.equal(
        run('/usr/bin/xcrun', ['lipo', '-archs', path.join(directory, file)]).trim(),
        expectedArch,
      );
      run('/usr/bin/codesign', ['--verify', '--strict', path.join(directory, file)]);
    }
  } else {
    const exe = await fs.readFile(path.join(directory, 'Teachshell.exe'));
    assert.equal(exe.toString('ascii', 0, 2), 'MZ');
    const pe = exe.readUInt32LE(0x3c);
    assert.equal(exe.toString('ascii', pe, pe + 4), 'PE\0\0');
    assert.equal(exe.readUInt16LE(pe + 4), 0x8664);
    assert.equal(
      await fs.stat(path.join(resources, 'teaching-session-keychain')).then(
        () => true,
        () => false,
      ),
      false,
    );
  }
  return hash(archive);
}
let mounted;
try {
  const directory = path.join(
    output,
    platform === 'darwin'
      ? (arch === 'arm64' ? 'mac-arm64' : 'mac') + '/Teachshell.app'
      : 'win-unpacked',
  );
  const asarSHA256 = await inspect(directory);
  for (const name of filenames) {
    const file = path.join(output, name);
    run(seven, ['t', file]);
    if (name.endsWith('.zip')) {
      const dest = path.join(scratch, 'zip');
      await fs.mkdir(dest);
      run('/usr/bin/ditto', ['-x', '-k', file, dest]);
      assert.equal(await inspect(path.join(dest, 'Teachshell.app')), asarSHA256);
    } else if (name.endsWith('.dmg')) {
      run('/usr/bin/hdiutil', ['verify', file]);
      const dest = path.join(scratch, 'dmg');
      await fs.mkdir(dest);
      run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', dest, file]);
      mounted = dest;
      assert.equal(await inspect(path.join(dest, 'Teachshell.app')), asarSHA256);
      run('/usr/bin/hdiutil', ['detach', dest]);
      mounted = undefined;
    } else {
      const dest = path.join(scratch, 'nsis');
      await fs.mkdir(dest);
      run(seven, ['e', '-y', '-o' + dest, file, '$PLUGINSDIR/app-64.7z']);
      const payload = path.join(dest, 'app-64.7z');
      run(seven, ['t', payload]);
      const unpacked = path.join(scratch, 'windows');
      await fs.mkdir(unpacked);
      run(seven, ['x', '-y', '-o' + unpacked, payload]);
      assert.equal(await inspect(unpacked), asarSHA256);
      assert.equal(
        await hash(path.join(unpacked, 'Teachshell.exe')),
        await hash(path.join(directory, 'Teachshell.exe')),
      );
    }
    console.log('PASS archive, version, commit and payload:', name);
  }
  const artifacts = await Promise.all(
    filenames.map(async (name) => ({
      name,
      size: (await fs.stat(path.join(output, name))).size,
      sha256: await hash(path.join(output, name)),
    })),
  );
  const manifest = {
    version: metadata.version,
    commit,
    platform,
    arch,
    verified: true,
    asarSHA256,
    signature: platform === 'darwin' ? 'ad-hoc, deep strict verified; not notarized' : 'unsigned',
    artifacts,
  };
  await fs.writeFile(
    path.join(output, `manifest-${platform}-${arch}.json`),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  if (mounted) run('/usr/bin/hdiutil', ['detach', mounted]);
  await fs.rm(scratch, { recursive: true, force: true });
}
