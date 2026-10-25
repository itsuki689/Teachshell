import { net } from 'electron';
import type { Session } from 'electron';
import { Readable } from 'node:stream';

function headers(input: Record<string, string | string[]>): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(input))
    for (const part of Array.isArray(value) ? value : [value]) result.append(key, part);
  return result;
}

/** net.fetch rejects manual redirects; net.request exposes their headers before following. */
export function sessionFetch(
  session: Session,
  raw: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = new URL(raw),
    method = (init.method ?? 'GET').toUpperCase();
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'selearning.nju.edu.cn' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !['GET', 'HEAD'].includes(method) ||
    init.body
  )
    throw new Error('不允许的教学下载请求');
  init.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = net.request({
      url: url.href,
      method,
      session,
      useSessionCookies: true,
      redirect: 'manual',
    });
    let incoming: Readable | undefined,
      settled = false;
    const cleanup = () => init.signal?.removeEventListener('abort', abort);
    const abort = () => {
      const error = init.signal?.reason ?? new Error('下载已取消');
      incoming?.destroy(error);
      request.abort();
      if (!settled) {
        settled = true;
        reject(error);
      }
      cleanup();
    };
    init.signal?.addEventListener('abort', abort, { once: true });
    request.on('error', (error) => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(error);
      } else incoming?.destroy(error);
    });
    request.on('redirect', (status, _method, target, responseHeaders) => {
      if (settled) return;
      settled = true;
      cleanup();
      const h = headers(responseHeaders);
      h.set('location', target);
      resolve(new Response(null, { status, headers: h }));
      // Deliberately never followRedirect: callers validate every hop before issuing it.
      request.abort();
    });
    request.on('response', (response) => {
      if (settled) return;
      settled = true;
      const h = headers(response.headers),
        status = response.statusCode;
      if (method === 'HEAD' || [204, 205, 304].includes(status)) {
        resolve(new Response(null, { status, headers: h }));
        cleanup();
        request.abort();
        return;
      }
      incoming = response as unknown as Readable;
      incoming.once('end', cleanup);
      incoming.once('close', () => {
        cleanup();
        request.abort();
      });
      resolve(
        new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
          status,
          headers: h,
        }),
      );
    });
    request.end();
  });
}
