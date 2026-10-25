import type { WebsiteResult } from '../../../shared/api.ts';

export type ObservationKind = 'teaching' | 'timetable';

/** The trusted parser and its source identity are sampled in one isolated-world execution. */
export function observationSource(script: string, kind: ObservationKind): string {
  const source = kind === 'teaching' ? `(${script})(document, location.href)` : script;
  return `(() => {
    const href = location.href;
    const title = document.title;
    const raw = ${source};
    if (location.href !== href) throw new Error('网页已导航，请重新读取');
    return { href, title, raw };
  })()`;
}

export function readObservation(
  observation: unknown,
  kind: ObservationKind,
  startedURL: string,
  currentURL: string,
): WebsiteResult {
  if (!observation || typeof observation !== 'object') throw new Error('网站解析返回的数据无效');
  const { href, title, raw } = observation as Record<string, unknown>;
  if (typeof href !== 'string' || href !== startedURL || href !== currentURL)
    throw new Error('网页已导航，请重新读取');
  if (typeof title !== 'string' || typeof raw !== 'string' || raw.length > 2 * 1024 * 1024)
    throw new Error('网站解析返回的数据无效或过大');
  return {
    url: href,
    title: title.slice(0, 1000),
    data: JSON.parse(kind === 'teaching' ? raw : decodeURIComponent(raw)),
  };
}
