import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import type { Repository } from '../storage/repository.ts';
import { component, safeExternal, safePath, identity } from '../filesystem/paths.ts';
import { assertID } from '../../../shared/model.ts';
import { digestFile as hash } from '../storage/atomic.ts';
/** Exports copies without changing the index, source files, or existing destination files. */
export async function exportMaterials(
  repo: Repository,
  ids: string[],
  destination: string,
): Promise<{ exported: number; destination: string }> {
  return repo.withWorkspace(async (state) => {
    if (!ids.length || ids.length > 5000 || new Set(ids).size !== ids.length)
      throw new Error('请选择1至5000份不同资料');
    for (const id of ids) assertID(id);
    const root = await safeExternal(destination);
    if (!(await fs.stat(root)).isDirectory()) throw new Error('导出目标必须是文件夹');
    const relative = path.relative(repo.root, root);
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    )
      throw new Error('请导出到资料库以外，避免混入管理目录');
    const materials = ids.map((id) => {
      const m = state.materials.find((m) => m.id === id);
      if (!m) throw new Error('资料不存在');
      return m;
    });
    const staging = await fs.mkdtemp(path.join(root, '.teachshelf-export-'));
    const created: { file: string; identity: string; hash: string }[] = [];
    try {
      const names = new Set((await fs.readdir(root)).map((n) => n.normalize('NFC').toLowerCase()));
      for (let i = 0; i < materials.length; i++) {
        const m = materials[i],
          source = await repo.resolveMaterial(m.id),
          before = await fs.stat(source),
          payload = path.join(staging, String(i));
        const originalHash = await hash(source);
        await fs.copyFile(source, payload, fs.constants.COPYFILE_EXCL);
        const after = await fs.stat(source);
        if (
          identity(before) !== identity(after) ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          (await hash(payload)) !== originalHash
        )
          throw new Error('导出时源文件发生变化，请重试');
        const ext = path.extname(m.originalName),
          stem = component(path.basename(m.originalName, ext), 200),
          safeExt = ext ? '.' + component(ext.slice(1), 32) : '';
        let name = stem + safeExt;
        for (let n = 2; names.has(name.normalize('NFC').toLowerCase()); n++)
          name = `${stem} ${n}${safeExt}`;
        const file = await safePath(root, name, true),
          handle = await fs.open(file, 'wx', 0o600);
        created.push({ file, identity: identity(await handle.stat()), hash: originalHash });
        try {
          for await (const chunk of createReadStream(payload)) await handle.writeFile(chunk);
          await handle.sync();
        } finally {
          await handle.close();
        }
        names.add(name.normalize('NFC').toLowerCase());
      }
      return { exported: created.length, destination: root };
    } catch (error) {
      const retained: unknown[] = [];
      for (const item of created.reverse()) {
        try {
          if (identity(await fs.lstat(item.file)) !== item.identity) {
            retained.push(new Error('导出文件已被替换，已保留：' + path.basename(item.file)));
            continue;
          }
          if (
            (await hash(item.file)) !== item.hash ||
            identity(await fs.lstat(item.file)) !== item.identity
          ) {
            retained.push(
              new Error('导出文件内容已变化或写入未完成，已保留：' + path.basename(item.file)),
            );
            continue;
          }
          await fs.unlink(item.file);
        } catch (cleanup) {
          if ((cleanup as NodeJS.ErrnoException).code !== 'ENOENT') retained.push(cleanup);
        }
      }
      if (retained.length)
        throw new AggregateError(
          [error, ...retained],
          '导出失败；已保留内容变化、被替换或无法安全清理的文件：' +
            retained
              .map((value) => (value instanceof Error ? value.message : String(value)))
              .join('；'),
        );
      throw error;
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });
}
