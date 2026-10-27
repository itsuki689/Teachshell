import chokidar from 'chokidar';
import path from 'node:path';

export function watchLibrary(root: string, platform: NodeJS.Platform = process.platform) {
  return chokidar.watch(path.join(root, 'files'), {
    ignoreInitial: true,
    followSymlinks: false,
    // Windows per-directory watch handles prevent renaming a parent with children.
    // Polling also permits Explorer moves; closing handles only for our own writes would not.
    usePolling: platform === 'win32',
    interval: 500,
    binaryInterval: 1000,
    awaitWriteFinish: { stabilityThreshold: 350, pollInterval: 100 },
    ignored: (p) => path.basename(p).startsWith('.'),
  });
}
