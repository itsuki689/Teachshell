import { downloadURL, teachingFile } from './download.ts';
import { teachingPageURL } from './teaching.ts';
import type { z } from 'zod';

/** Resolve Moodle resource redirects with HEAD; attachment bodies are never consumed. */
export async function resourceHead(
  fetcher: typeof fetch,
  raw: string,
  signal: AbortSignal,
): Promise<z.infer<typeof teachingFile> | undefined> {
  const source = teachingPageURL(raw);
  if (source.kind !== 'resource') return;
  let url = source.url;
  for (let i = 0; i < 6; i++) {
    const response = await fetcher(url.href, { method: 'HEAD', redirect: 'manual', signal });
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get('location');
      if (!target) throw new Error('资料跳转缺少地址');
      const next = new URL(target, url);
      if (next.pathname.startsWith('/pluginfile.php/')) downloadURL(next.href);
      else {
        const page = teachingPageURL(next.href);
        if (page.kind !== 'resource' || page.id !== source.id)
          throw new Error('资料跳转离开原活动，请重新登录后检查');
      }
      url = next;
      continue;
    }
    if (!response.ok) throw new Error('资料检查失败：' + response.status);
    if (url.pathname.startsWith('/pluginfile.php/')) {
      downloadURL(url.href);
      if (
        /^(text\/html|application\/xhtml\+xml)(;|$)/i.test(
          response.headers.get('content-type') ?? '',
        )
      )
        throw new Error('资料检查返回登录页');
      const key = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
      const disposition = response.headers.get('content-disposition') ?? '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
      const name = encoded ? decodeURIComponent(encoded) : (plain ?? key);
      if (!name || /[\\/\0]/.test(name) || name === '.' || name === '..')
        throw new Error('下载文件名无效');
      return teachingFile.parse({ key, name, url: url.href, subfolders: [] });
    }
    if (
      !/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(
        response.headers.get('content-type') ?? '',
      )
    )
      throw new Error('无法在下载前安全识别资料页面');
    return;
  }
  throw new Error('资料跳转过多');
}
