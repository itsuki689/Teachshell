import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { exists, safePath, safeExternal, identity } from '../filesystem/paths.ts';
export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export async function digestFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function atomicWrite(
  root: string,
  name: string,
  data: string,
  backup = false,
): Promise<void> {
  const target = await safePath(root, name, true);
  const temp = await safePath(root, `.desktop-${randomUUID()}.tmp`, true);
  try {
    const h = await fs.open(temp, 'wx', 0o600);
    try {
      await h.writeFile(data);
      await h.sync();
    } finally {
      await h.close();
    }
    if (backup && (await exists(target))) {
      const old = await fs.readFile(target, 'utf8');
      await atomicWrite(root, name + '.bak', old);
    }
    await fs.rename(temp, target);
    // Windows cannot fsync directory handles; the flushed file + atomic rename still applies.
    if (process.platform !== 'win32') {
      const dir = await fs.open(root, 'r');
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export interface FileOp {
  kind: 'move' | 'copy' | 'mkdir';
  from?: string;
  to: string;
  identity?: string;
  hash?: string;
  staging?: string;
  sourceHash?: string;
  linkMove?: boolean;
}
interface Journal {
  version: 1;
  before: string;
  after: string;
  ops: FileOp[];
}
const journalName = '.desktop-transaction.json';
async function target(root: string, relative: string) {
  return safePath(root, relative);
}
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** link() creates the destination exclusively. Flush it before removing the
 * source so a power loss cannot persist only the unlink on POSIX filesystems. */
async function linkMove(from: string, to: string, expected: string, linked?: () => void) {
  const source = await fs.lstat(from);
  if (!source.isFile() || identity(source) !== expected)
    throw new Error('移动源文件身份已变化，文件保留');
  try {
    await fs.link(from, to);
  } catch (error) {
    if (
      ['EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? '',
      )
    )
      throw new Error(
        '资料库文件系统不支持安全硬链接移动，请使用支持硬链接的本地卷；原文件未移动。',
      );
    throw error;
  }
  if (identity(await fs.lstat(to)) !== expected || identity(await fs.lstat(from)) !== expected)
    throw new Error('移动期间文件身份已变化，保留两份路径等待恢复');
  await syncDirectory(path.dirname(to));
  linked?.();
  await fs.unlink(from);
  await syncDirectory(path.dirname(from));
}
async function rollback(root: string, j: Journal) {
  for (const op of [...j.ops].reverse()) {
    const to = await target(root, op.to);
    if (!(await exists(to))) continue;
    if (op.kind === 'mkdir') continue; // Harmless empty directories are retained; never delete an unowned directory.
    if (op.kind === 'copy') {
      if (identity(await fs.lstat(to)) !== op.identity) continue;
      if ((await digestFile(to)) !== op.hash)
        throw new Error('导入文件已变化，保留事务日志等待恢复：' + op.to);
      await fs.unlink(to);
      continue;
    }
    const from = await target(root, op.from!);
    if (await exists(from)) {
      if (identity(await fs.lstat(to)) === op.identity) {
        if (op.linkMove && identity(await fs.lstat(from)) === op.identity) {
          await fs.unlink(to);
          await syncDirectory(path.dirname(to));
          continue;
        }
        throw new Error('恢复路径冲突，保留两份文件：' + op.from);
      }
      continue;
    }
    if (identity(await fs.lstat(to)) !== op.identity)
      throw new Error('恢复文件身份不匹配：' + op.to);
    await fs.mkdir(path.dirname(from), { recursive: true });
    if ((await fs.lstat(to)).isFile()) await linkMove(to, from, op.identity!);
    else await fs.rename(to, from);
  }
}
export async function recoverTransaction(root: string) {
  const file = await safePath(root, journalName, true);
  if (!(await exists(file))) return;
  const j = JSON.parse(await fs.readFile(file, 'utf8')) as Journal;
  if (
    j.version !== 1 ||
    !Array.isArray(j.ops) ||
    j.ops.length > 100000 ||
    typeof j.before !== 'string' ||
    typeof j.after !== 'string'
  )
    throw new Error('无效的恢复日志');
  for (const op of j.ops) {
    if (!op || !['mkdir', 'copy', 'move'].includes(op.kind)) throw new Error('无效的恢复操作');
    await target(root, op.to);
    if (op.kind === 'move') await target(root, op.from!);
    if (op.kind !== 'mkdir' && (typeof op.identity !== 'string' || !op.identity))
      throw new Error('无效的恢复文件身份');
    if (op.kind === 'copy' && (typeof op.hash !== 'string' || !/^[a-f0-9]{64}$/.test(op.hash)))
      throw new Error('无效的恢复文件校验值');
    // Validate every cleanup path before rollback can move or remove any file.
    if (op.staging !== undefined) {
      if (typeof op.staging !== 'string' || !/^\.desktop-copy-[0-9a-f-]+$/.test(op.staging))
        throw new Error('无效暂存路径');
      await safePath(root, op.staging, true);
    }
  }
  const current = digest(await fs.readFile(await safePath(root, 'library.json', true)));
  if (current === j.before) await rollback(root, j);
  else if (current !== j.after) throw new Error('索引与事务日志不匹配，请恢复备份；文件未修改');
  for (const op of j.ops)
    if (op.staging) {
      const p = await safePath(root, op.staging, true);
      if ((await exists(p)) && identity(await fs.lstat(p)) === op.identity) await fs.unlink(p);
    }
  await fs.unlink(file);
}
export async function commitTransaction(
  root: string,
  next: unknown,
  operations: FileOp[],
  fault?: (point: string) => void,
  beforeCommit?: () => void | Promise<void>,
) {
  if (operations.length > 100000) throw new Error('文件操作超过事务恢复支持的数量，请分批处理');
  const index = await safePath(root, 'library.json', true);
  const before = await fs.readFile(index);
  const data = JSON.stringify(next, null, 2) + '\n';
  const ops: FileOp[] = [];
  const staged: FileOp[] = [];
  const cleanStaged = async () => {
    for (const op of staged) {
      const p = await safePath(root, op.staging!, true);
      if ((await exists(p)) && identity(await fs.lstat(p)) === op.identity) await fs.unlink(p);
    }
  };
  try {
    for (const operation of operations) {
      const op = { ...operation };
      const destination = await target(root, op.to);
      if (op.kind === 'move') {
        const source = await target(root, op.from!),
          stat = await fs.lstat(source);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('移动仅支持普通文件或目录');
        op.identity = identity(stat);
        op.linkMove = stat.isFile();
        if (await exists(destination)) {
          const same = identity(await fs.lstat(destination)) === op.identity;
          const caseOnly =
            op.from!.normalize('NFC').toLowerCase() === op.to.normalize('NFC').toLowerCase();
          const actualNames = await fs.readdir(path.dirname(source));
          if (same && caseOnly && !actualNames.includes(path.basename(destination))) {
            const temporary = path.posix.dirname(op.from!) + '/.desktop-move-' + randomUUID();
            ops.push({
              kind: 'move',
              from: op.from,
              to: temporary,
              identity: op.identity,
              linkMove: op.linkMove,
            });
            op.from = temporary;
          } else throw new Error('目标已存在，未覆盖：' + op.to);
        }
      }
      if (op.kind === 'copy') {
        const source = await safeExternal(op.from!);
        if (!(await fs.lstat(source)).isFile()) throw new Error('只支持复制普通文件');
        op.staging = '.desktop-copy-' + randomUUID();
        const p = await safePath(root, op.staging, true);
        await fs.copyFile(source, p, fs.constants.COPYFILE_EXCL);
        op.identity = identity(await fs.lstat(p));
        staged.push(op);
        // Windows FlushFileBuffers requires a writable handle. Change only the private
        // staging copy, restoring a copied read-only attribute after flushing it.
        const copiedMode = (await fs.stat(p)).mode;
        const readOnlyCopy = process.platform === 'win32' && !(copiedMode & 0o200);
        if (readOnlyCopy) await fs.chmod(p, copiedMode | 0o200);
        const handle = await fs.open(p, process.platform === 'win32' ? 'r+' : 'r');
        try {
          await handle.sync();
        } finally {
          await handle.close();
          if (readOnlyCopy) await fs.chmod(p, copiedMode);
        }
        op.hash = await digestFile(p);
        if (op.sourceHash !== undefined && op.hash !== op.sourceHash)
          throw new Error('迁移期间原文件已变化，原文件和索引保留');
      }
      ops.push(op);
    }
    if (ops.length > 100000) throw new Error('文件操作超过事务恢复支持的数量，请分批处理');
    const j: Journal = { version: 1, before: digest(before), after: digest(data), ops };
    await atomicWrite(root, journalName, JSON.stringify(j));
  } catch (error) {
    await cleanStaged();
    throw error;
  }
  // A journal checkpoint simulates process death: leave it intact for next-open recovery.
  fault?.('journal');
  try {
    for (const op of ops) {
      const to = await target(root, op.to);
      if (op.kind === 'mkdir') {
        await fs.mkdir(to);
        continue;
      }
      if (await exists(to)) throw new Error('目标已存在，未覆盖：' + op.to);
      if (op.kind === 'copy') {
        try {
          await fs.link(await safePath(root, op.staging!, true), to);
        } catch (error) {
          if (['EXDEV', 'ENOTSUP', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? ''))
            throw new Error(
              '资料库文件系统不支持安全硬链接导入，请将资料库放在同一支持硬链接的本地卷；原文件未移动。',
            );
          throw error;
        }
      } else if (op.linkMove)
        await linkMove(await target(root, op.from!), to, op.identity!, () =>
          fault?.('move-linked'),
        );
      // Node has no portable exclusive directory rename. A competing non-empty
      // directory is rejected by the OS; an empty-directory race remains possible.
      else await fs.rename(await target(root, op.from!), to);
    }
    fault?.('files');
    // Teaching versions and legacy migration promise that the approved source
    // bytes are still current when publishing the new index. Original paths are
    // never removed by these copy operations, including on a failed recheck.
    for (const op of ops)
      if (op.kind === 'copy' && op.sourceHash !== undefined) {
        if ((await digestFile(await safeExternal(op.from!))) !== op.sourceHash)
          throw new Error('提交前原文件已变化，原文件与旧索引保留，请重新确认');
      }
    await beforeCommit?.();
    if (digest(await fs.readFile(index)) !== digest(before))
      throw new Error('提交期间索引被另一程序修改，保留文件和事务日志等待核对');
    await atomicWrite(root, 'library.json', data, true);
    fault?.('index');
  } catch (error) {
    try {
      await recoverTransaction(root);
    } catch (recovery) {
      throw new Error(`操作失败且恢复未完成：${String(recovery)}；原错误 ${String(error)}`);
    }
    throw error;
  }
  await recoverTransaction(root);
}
