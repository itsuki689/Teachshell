import chokidar from 'chokidar';
import path from 'node:path';
import { watch as watchNative, type FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';

// Consumers receive invalidations, not an authoritative file operation log.
// Repository.sync() reads the actual tree and preserves identities across moves.
export function watchMacLibrary(root: string, nativeWatch = watchNative) {
  const events = new EventEmitter() as EventEmitter & { close(): Promise<void> };
  let handle: FSWatcher | undefined;
  let closed = false;
  events.close = async () => {
    closed = true;
    handle?.close();
    handle = undefined;
  };
  try {
    // Watch the stable library ancestor so replacing files/ also remains visible.
    // macOS recursive fs.watch registers once, before reporting ready; it avoids
    // Chokidar's scan -> addDir -> per-directory registration/throttle races.
    handle = nativeWatch(root, { recursive: true }, (_event, filename) => {
      if (closed) return;
      if (filename !== null && filename.length > 0) {
        const relative = path.relative(root, path.resolve(root, filename.toString()));
        const parts = relative.split(path.sep);
        if (parts[0] !== 'files' || parts.some((part) => part.startsWith('.'))) return;
      }
      // A missing filename is valid for fs.watch. Never discard that invalidation.
      events.emit('all', 'change', path.join(root, 'files'));
    });
    handle.on('error', (error) => {
      if (!closed) events.emit('error', error);
    });
    queueMicrotask(() => {
      if (!closed) events.emit('ready');
    });
  } catch (error) {
    // Match the async watcher API, allowing the caller to attach its error handler.
    queueMicrotask(() => {
      if (!closed) events.emit('error', error);
    });
  }
  return events;
}

export function watchLibrary(root: string, platform: NodeJS.Platform = process.platform) {
  if (platform === 'darwin') return watchMacLibrary(root);
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
