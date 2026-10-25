import fs from 'node:fs/promises';
import path from 'node:path';
import type { LibraryState } from '../../../shared/model.ts';
import { courseDirectory, exists, safePath } from '../filesystem/paths.ts';
import { digestFile } from './atomic.ts';
import type { FileOp } from './atomic.ts';

interface PlannedEntry {
  path: string;
  directory: boolean;
  source?: string;
}
export interface HomeworkMigration {
  sourceRoots: string[];
  copied: number;
  deduplicated: number;
}
const folded = (value: string) => value.normalize('NFC').toLowerCase();
function portableName(value: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[\x00-\x1f\x7f/\\:<>"|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    Buffer.byteLength(value) > 255 ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)
  )
    throw new Error('旧作业含无法跨平台保留的名称，请先在原副本内改名：' + value);
  return value;
}
function numberedName(name: string, number: number): string {
  const extension = path.posix.extname(name),
    suffix = ` ${number}${extension}`,
    stem = path.posix.basename(name, extension);
  let result = '';
  for (const { segment } of new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(stem)) {
    if (Buffer.byteLength(result + segment + suffix) > 255) break;
    result += segment;
  }
  return portableName(result + suffix);
}

/** Plans a non-destructive equivalent of Swift homeworkRelocations. The caller
 * commits these copies together with the migration marker in library.json. */
export async function prepareLegacyHomework(
  root: string,
  state: LibraryState,
  ops: FileOp[],
): Promise<HomeworkMigration> {
  const result: HomeworkMigration = { sourceRoots: [], copied: 0, deduplicated: 0 };
  if ((state.desktopLegacyHomeworkMigration as { version?: unknown } | undefined)?.version === 1)
    return result;
  const planned = new Map<string, PlannedEntry>();
  for (const op of ops)
    planned.set(folded(op.to), {
      path: op.to,
      directory: op.kind === 'mkdir',
      source: op.from
        ? op.kind === 'copy'
          ? op.from
          : await safePath(root, op.from, true)
        : undefined,
    });
  const directoryEntries = new Map<string, string[]>(),
    hashes = new Map<string, string>();
  let count = 0;
  const fileHash = async (file: string) => {
    let hash = hashes.get(file);
    if (hash === undefined) {
      hash = await digestFile(file);
      hashes.set(file, hash);
    }
    return hash;
  };
  const lookup = async (relative: string): Promise<PlannedEntry | undefined> => {
    const pending = planned.get(folded(relative));
    if (pending) return pending;
    const parent = path.posix.dirname(relative),
      absolute = await safePath(root, parent, true);
    if (!(await exists(absolute))) return undefined;
    if (!(await fs.lstat(absolute)).isDirectory())
      throw new Error('作业目标父路径不是文件夹：' + parent);
    let names = directoryEntries.get(parent);
    if (!names) {
      names = await fs.readdir(absolute);
      directoryEntries.set(parent, names);
    }
    const matches = names.filter((name) => folded(name) === folded(path.posix.basename(relative)));
    if (matches.length > 1) throw new Error('作业目标包含大小写或Unicode名称冲突：' + relative);
    if (!matches.length) return undefined;
    const actual = parent + '/' + matches[0],
      target = await safePath(root, actual, true),
      stat = await fs.lstat(target);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('作业目标包含特殊文件：' + actual);
    return { path: actual, directory: stat.isDirectory(), source: target };
  };
  const ensureDirectory = async (relative: string): Promise<string> => {
    if (relative === 'files') return relative;
    const parent = await ensureDirectory(path.posix.dirname(relative));
    const candidate = parent + '/' + portableName(path.posix.basename(relative));
    const existing = await lookup(candidate);
    if (existing) {
      if (!existing.directory)
        throw new Error('课程目录中的“作业”或其父目录已被文件占用：' + existing.path);
      return existing.path;
    }
    ops.push({ kind: 'mkdir', to: candidate });
    planned.set(folded(candidate), { path: candidate, directory: true });
    return candidate;
  };
  const visit = async (sourceRelative: string, proposed: string, depth = 0): Promise<void> => {
    if (depth > 64 || ++count > 90000) throw new Error('旧作业目录过深或项目过多，原文件保留');
    const source = await safePath(root, sourceRelative, true),
      stat = await fs.lstat(source);
    if (!stat.isDirectory() && !stat.isFile())
      throw new Error('旧作业仅支持普通文件和目录：' + sourceRelative);
    const directory = stat.isDirectory(),
      parent = path.posix.dirname(proposed),
      name = portableName(path.posix.basename(proposed));
    let target = proposed,
      existing: PlannedEntry | undefined;
    for (let number = 1; number <= 10000; number++) {
      target = parent + '/' + (number === 1 ? name : numberedName(name, number));
      existing = await lookup(target);
      if (!existing) break;
      if (directory && existing.directory) {
        target = existing.path;
        break;
      }
      if (
        !directory &&
        !existing.directory &&
        existing.source &&
        (await fileHash(source)) === (await fileHash(existing.source))
      ) {
        result.deduplicated++;
        return;
      }
      if (number === 10000) throw new Error('旧作业同名冲突过多：' + sourceRelative);
    }
    if (directory) {
      if (!existing) {
        ops.push({ kind: 'mkdir', to: target });
        planned.set(folded(target), { path: target, directory: true, source });
      }
      for (const child of (await fs.readdir(source)).sort())
        await visit(sourceRelative + '/' + child, target + '/' + portableName(child), depth + 1);
    } else {
      ops.push({ kind: 'copy', from: source, to: target, sourceHash: await fileHash(source) });
      planned.set(folded(target), { path: target, directory: false, source });
      result.copied++;
    }
  };
  const files = await safePath(root, 'files', true),
    courseFolders = (await fs.readdir(files)).sort();
  const legacy = await safePath(root, 'HomeworkFiles', true),
    legacyNames = (await exists(legacy)) ? await fs.readdir(legacy) : [];
  for (const course of [...state.courses, undefined]) {
    const id = course?.id ?? 'Unassigned',
      proposed = courseDirectory(course) + '/作业';
    const sources = legacyNames
      .filter((name) => folded(name) === folded(id))
      .map((name) => 'HomeworkFiles/' + name);
    if (course)
      sources.push(
        ...courseFolders
          .filter((name) => folded(name).endsWith(folded(` [${course.id}]`)))
          .map((name) => 'files/' + name + '/作业'),
      );
    for (const relative of sources) {
      if (relative === proposed || !(await exists(await safePath(root, relative, true)))) continue;
      if (relative.startsWith(proposed + '/') || proposed.startsWith(relative + '/'))
        throw new Error('旧作业源目录与目标目录重叠，原件保留');
      const source = await safePath(root, relative, true);
      if (!(await fs.lstat(source)).isDirectory())
        throw new Error('旧作业根路径不是文件夹：' + relative);
      const target = await ensureDirectory(proposed);
      await visit(relative, target);
      result.sourceRoots.push(relative);
    }
  }
  return result;
}
