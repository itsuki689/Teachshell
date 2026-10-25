import fs from 'node:fs/promises';
import { z } from 'zod';
export const teachingFile = z
  .object({
    key: z.string().min(1).max(4000),
    name: z.string().min(1).max(1000),
    url: z.string().url(),
    subfolders: z.array(z.string()).max(30),
  })
  .strict();
export const teachingPage = z
  .object({
    kind: z.enum(['course', 'folder', 'assign', 'resource']),
    accountID: z.string().regex(/^\d+$/),
    courseID: z.string().regex(/^\d+$/),
    title: z.string().max(500),
    files: z.array(teachingFile).max(3000),
    activities: z
      .array(
        z
          .object({
            id: z.string(),
            kind: z.string(),
            title: z.string(),
            sectionID: z.string(),
            section: z.string(),
            url: z.string().url(),
          })
          .strict(),
      )
      .max(3000),
    intro: z.string().max(80000),
    deadlineText: z.string(),
    submitted: z.boolean(),
  })
  .strict();
export function downloadURL(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'selearning.nju.edu.cn' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !url.pathname.startsWith('/pluginfile.php/') ||
    ![
      '/mod_folder/content/',
      '/mod_resource/content/',
      '/mod_assign/introattachment/',
      '/mod_assign/intro/',
    ].some((p) => url.pathname.includes(p))
  )
    throw new Error('拒绝非教学资料下载地址');
  return url;
}
export function validateDownload(prefix: Buffer, size: number, name: string) {
  if (size <= 0 || size > 512 * 1024 * 1024) throw new Error('下载为空或超过512MB');
  const text = prefix.toString('utf8').trimStart().toLowerCase();
  if (
    text.startsWith('<!doctype html') ||
    text.startsWith('<html') ||
    text.includes('type="password"')
  )
    throw new Error('下载结果是登录网页，请重新登录');
  if (/\.pdf$/i.test(name) && !prefix.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new Error('下载不是有效的PDF');
  if (/\.(pptx|docx|xlsx|zip)$/i.test(name) && !prefix.subarray(0, 2).equals(Buffer.from('PK')))
    throw new Error('下载不是有效Office或ZIP文件');
}
export async function downloadFile(
  fetcher: typeof fetch,
  raw: string,
  destination: string,
  name: string,
) {
  let url = downloadURL(raw),
    response: Response | undefined;
  const signal = AbortSignal.timeout(120000);
  for (let n = 0; n < 6; n++) {
    response = await fetcher(url.href, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('下载重定向缺少地址');
      url = downloadURL(new URL(next, url).href);
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body) throw new Error('下载失败：' + response?.status);
  if (
    /^(text\/html|application\/xhtml\+xml)(;|$)/i.test(response.headers.get('content-type') ?? '')
  ) {
    await response.body.cancel();
    throw new Error('下载结果是HTML网页，请重新登录');
  }
  if (Number(response.headers.get('content-length')) > 512 * 1024 * 1024) {
    await response.body.cancel();
    throw new Error('文件超过512MB');
  }
  let h;
  try {
    h = await fs.open(destination, 'wx', 0o600);
  } catch (e) {
    await response.body.cancel();
    throw e;
  }
  let size = 0;
  let prefix = Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 512 * 1024 * 1024) throw new Error('文件超过512MB');
      if (prefix.length < 4096)
        prefix = Buffer.concat([prefix, Buffer.from(value.subarray(0, 4096 - prefix.length))]);
      await h.writeFile(value);
    }
    validateDownload(prefix, size, name);
    await h.sync();
  } catch (e) {
    await reader.cancel().catch(() => {});
    await h.close();
    await fs.rm(destination, { force: true });
    throw e;
  }
  await h.close();
}
