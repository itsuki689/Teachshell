const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const expected = Arch[context.arch] === 'x64' ? 'x86_64' : Arch[context.arch];
  const helper = path.join(context.packager.info.appDir, 'dist-electron/teaching-session-keychain');
  const actual = execFileSync('xcrun', ['lipo', '-archs', helper], { encoding: 'utf8' }).trim();
  if (!['arm64', 'x86_64'].includes(expected) || actual !== expected)
    throw new Error(`Keychain helper is ${actual}; build this macOS Release on ${expected}.`);
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', helper]);
};
