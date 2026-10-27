const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (Arch[context.arch] !== 'arm64')
    throw new Error(
      'macOS releases support Apple Silicon (arm64) only; Intel Mac is no longer supported.',
    );
  const helper = path.join(context.packager.info.appDir, 'dist-electron/teaching-session-keychain');
  const actual = execFileSync('xcrun', ['lipo', '-archs', helper], { encoding: 'utf8' }).trim();
  if (actual !== 'arm64')
    throw new Error(`Keychain helper is ${actual}; build this macOS Release on arm64.`);
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', helper]);
};
