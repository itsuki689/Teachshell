import fs from 'node:fs/promises';
import path from 'node:path';
import type { Repository } from '../storage/repository.ts';
import type { Course, LibraryState } from '../../../shared/model.ts';
import { assertID } from '../../../shared/model.ts';
import {
  courseDirectory,
  safePath,
  safeExternal,
  component,
  exists,
  identity,
} from '../filesystem/paths.ts';

export interface HomeworkEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}
export interface HomeworkListing {
  courseID?: string;
  relative: string;
  root: string;
  mounted: boolean;
  entries: HomeworkEntry[];
}
export interface HomeworkImport {
  imported: number;
  skipped: number;
  errors: string[];
}
const folded = (value: string) => value.normalize('NFC').toLocaleLowerCase('en-US');
function workspaceName(name: string): string {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    name.trim() !== name ||
    /[\x00-\x1f\x7f/\\:<>"|?*]/.test(name) ||
    /[. ]$/.test(name) ||
    Buffer.byteLength(name) > 255 ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
  )
    throw new Error('名称含跨平台不支持的字符或保留名称');
  return name;
}
function within(child: string, parent: string): boolean {
  const a = folded(path.resolve(child)),
    b = folded(path.resolve(parent));
  return a === b || a.startsWith(b + path.sep);
}
function course(state: LibraryState, id?: string): Course | undefined {
  if (id === undefined) return;
  assertID(id);
  const value = state.courses.find((c) => c.id.toUpperCase() === id.toUpperCase());
  if (!value) throw new Error('课程不存在');
  return value;
}
function relative(value: string, allowEmpty = true): string {
  if (
    typeof value !== 'string' ||
    value.length > 16000 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.includes(':') ||
    path.isAbsolute(value) ||
    (!allowEmpty && !value) ||
    value.split('/').some((p) => (!p && value !== '') || p === '.' || p === '..')
  )
    throw new Error('不安全的作业路径');
  return value;
}
async function directory(file: string) {
  const st = await fs.lstat(file);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('不是安全的普通文件夹');
}
/** Existing disconnected mounts still reserve their stored location, matching Swift. */
export async function validateHomeworkMount(
  root: string,
  state: LibraryState,
  courseID: string,
  candidate: string,
): Promise<string> {
  course(state, courseID);
  const selected = await safeExternal(candidate);
  await directory(selected);
  const canonical = await fs.realpath(selected),
    library = await fs.realpath(root);
  if (within(canonical, library) || within(library, canonical))
    throw new Error('挂载的作业文件夹必须位于资料库外部，且不能包含资料库');
  for (const other of state.courses) {
    if (other.id.toUpperCase() === courseID.toUpperCase() || !other.homeworkFolder) continue;
    const stored = other.homeworkFolder;
    if (!path.isAbsolute(stored)) continue;
    let mounted = path.resolve(stored);
    try {
      mounted = await fs.realpath(stored);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
    if (within(canonical, mounted) || within(mounted, canonical))
      throw new Error(`该文件夹与课程“${other.name}”的作业挂载重叠`);
  }
  return canonical;
}
async function child(base: string, rel: string) {
  relative(rel);
  return rel ? await safePath(base, rel, true) : base;
}
async function entry(base: string, file: string): Promise<HomeworkEntry> {
  const st = await fs.lstat(file);
  if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()))
    throw new Error('仅支持普通文件和文件夹');
  return {
    name: path.basename(file),
    relativePath: path.relative(base, file).split(path.sep).join('/'),
    isDirectory: st.isDirectory(),
    size: st.size,
    modifiedAt: st.mtimeMs,
  };
}
async function unique(parent: string, name: string): Promise<string> {
  const clean = workspaceName(name),
    names = new Set((await fs.readdir(parent)).map(folded)),
    ext = path.extname(clean),
    stem = path.basename(clean, ext);
  if (!names.has(folded(clean))) return path.join(parent, clean);
  for (let n = 2; n <= 10000; n++) {
    const suffix = ` ${n}${ext}`,
      next = component(stem, 255 - Buffer.byteLength(suffix)) + suffix;
    if (!names.has(folded(next))) return path.join(parent, next);
  }
  throw new Error('同名文件过多，请先整理作业文件夹');
}
/** Copies only regular nodes; symlinks and changing source files abort the whole item. */
async function copyTree(
  source: string,
  destination: string,
  depth = 0,
  count = { value: 0 },
): Promise<void> {
  if (depth > 64 || ++count.value > 100000) throw new Error('导入目录过深或项目过多');
  const safe = await safeExternal(source),
    st = await fs.lstat(safe);
  if (st.isDirectory()) {
    await fs.mkdir(destination, { mode: 0o700 });
    const names = await fs.readdir(safe),
      seen = new Set<string>();
    for (const name of names) {
      workspaceName(name);
      if (seen.has(folded(name))) throw new Error('目录包含大小写或Unicode归一化冲突的名称');
      seen.add(folded(name));
      await copyTree(path.join(safe, name), path.join(destination, name), depth + 1, count);
    }
    return;
  }
  if (!st.isFile()) throw new Error('仅支持导入普通文件和文件夹');
  const input = await fs.open(safe, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let output: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const before = await input.stat();
    if (!before.isFile() || identity(before) !== identity(st)) throw new Error('导入源已变化');
    output = await fs.open(destination, 'wx', 0o600);
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      await output.writeFile(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await input.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || position !== before.size)
      throw new Error('复制期间原文件发生变化');
    await output.sync();
  } finally {
    try {
      await output?.close();
    } finally {
      await input.close();
    }
  }
}

export class HomeworkService {
  private getRepository: () => Repository;
  constructor(getRepository: () => Repository) {
    this.getRepository = getRepository;
  }
  private access<T>(
    courseID: string | undefined,
    action: (repo: Repository, state: LibraryState, base: string, mounted: boolean) => Promise<T>,
  ): Promise<T> {
    const repo = this.getRepository();
    return repo.withWorkspace(async (state) => {
      if (this.getRepository() !== repo) throw new Error('资料库已切换');
      const c = course(state, courseID);
      let base: string;
      if (c?.homeworkFolder)
        base = await validateHomeworkMount(repo.root, state, c.id, c.homeworkFolder);
      else {
        if (c?.isMissing) throw new Error('课程目录缺失，请先恢复原目录');
        base = await safePath(repo.root, courseDirectory(c) + '/作业');
        await fs.mkdir(base, { recursive: true, mode: 0o700 });
        await directory(base);
      }
      return action(repo, state, base, !!c?.homeworkFolder);
    });
  }
  list(courseID?: string, rel = ''): Promise<HomeworkListing> {
    return this.access(courseID, async (_repo, _state, base, mounted) => {
      const folder = await child(base, rel);
      await directory(folder);
      const entries: HomeworkEntry[] = [];
      for (const name of await fs.readdir(folder)) {
        if (name.startsWith('.')) continue;
        const file = path.join(folder, name),
          st = await fs.lstat(file);
        if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) continue;
        entries.push(await entry(base, file));
      }
      entries.sort(
        (a, b) =>
          Number(b.isDirectory) - Number(a.isDirectory) ||
          a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
      );
      return { courseID, relative: rel, root: base, mounted, entries };
    });
  }
  createFolder(courseID: string | undefined, rel: string, name: string): Promise<HomeworkEntry> {
    return this.access(courseID, async (_repo, _state, base) => {
      const parent = await child(base, rel);
      await directory(parent);
      const destination = await unique(parent, name);
      await fs.mkdir(destination, { mode: 0o700 });
      return entry(base, destination);
    });
  }
  rename(courseID: string | undefined, rel: string, name: string): Promise<HomeworkEntry> {
    return this.access(courseID, async (_repo, _state, base) => {
      relative(rel, false);
      workspaceName(name);
      const source = await child(base, rel);
      const before = await entry(base, source);
      if (before.name === name) return before;
      const parent = path.dirname(source),
        destination = await child(base, path.posix.join(path.posix.dirname(rel), name));
      if (
        (await fs.readdir(parent)).some(
          (existing) => existing !== before.name && folded(existing) === folded(name),
        )
      )
        throw new Error('目标名称已存在，未覆盖');
      if (folded(before.name) === folded(name))
        throw new Error('仅改变大小写或Unicode形式的改名请分两次完成');
      if (await exists(destination)) throw new Error('目标名称已存在，未覆盖');
      await fs.rename(source, destination);
      return entry(base, destination);
    });
  }
  importFiles(
    courseID: string | undefined,
    rel: string,
    sources: string[],
  ): Promise<HomeworkImport> {
    return this.access(courseID, async (_repo, _state, base) => {
      if (!Array.isArray(sources) || sources.length > 5000) throw new Error('一次最多导入5000项');
      const folder = await child(base, rel);
      await directory(folder);
      const result: HomeworkImport = { imported: 0, skipped: 0, errors: [] };
      for (const source of sources) {
        let staging: string | undefined;
        try {
          const safe = await safeExternal(source),
            st = await fs.lstat(safe);
          if (st.isDirectory() && within(folder, safe))
            throw new Error('不能将文件夹导入到自身内部');
          const name = workspaceName(path.basename(safe));
          staging = await fs.mkdtemp(path.join(folder, '.homework-import-'));
          const payload = path.join(staging, 'payload');
          await copyTree(safe, payload);
          const destination = await unique(folder, name);
          if (st.isFile()) {
            try {
              await fs.link(payload, destination);
            } catch (error) {
              if (
                !['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(
                  (error as NodeJS.ErrnoException).code ?? '',
                )
              )
                throw error;
              // External homework can be on exFAT/FAT volumes without hard-link support.
              await fs.copyFile(payload, destination, fs.constants.COPYFILE_EXCL);
              // FlushFileBuffers requires write access on Windows.
              const handle = await fs.open(destination, process.platform === 'win32' ? 'r+' : 'r');
              try {
                await handle.sync();
              } finally {
                await handle.close();
              }
            }
            await fs.unlink(payload);
          } else {
            if (await exists(destination)) throw new Error('目标已存在');
            await fs.rename(payload, destination);
          }
          result.imported++;
        } catch (error) {
          result.skipped++;
          result.errors.push(
            `${path.basename(String(source))}：${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          if (staging) await fs.rm(staging, { recursive: true, force: true });
        }
      }
      return result;
    });
  }
  resolve(courseID: string | undefined, rel: string): Promise<string> {
    return this.access(courseID, async (_repo, _state, base) => {
      const selected = await child(base, rel);
      await entry(base, selected);
      return selected;
    });
  }
  mountPath(courseID: string, candidate: string): Promise<string> {
    const repo = this.getRepository();
    return repo.withWorkspace(async (state) => {
      if (this.getRepository() !== repo) throw new Error('资料库已切换');
      return validateHomeworkMount(repo.root, state, courseID, candidate);
    });
  }
}
