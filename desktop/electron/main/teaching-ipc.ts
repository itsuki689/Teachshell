import { z } from 'zod';
import type { Repository } from '../services/storage/repository.ts';
import type { WebsiteBrowser } from '../services/website/browser.ts';
import type { WebsiteResult } from '../../shared/api.ts';
import { AssignmentSyncService } from '../services/website/assignment-sync.ts';
import { teachingPage } from '../services/website/download.ts';
import { teachingPageURL } from '../services/website/teaching.ts';
export interface WebsiteProposal {
  result: WebsiteResult;
  root: string;
  revision: string;
  created: number;
}
interface Context {
  handle: (name: string, args: z.ZodType, fn: (...args: any[]) => unknown) => void;
  repository: () => Repository;
  browser: () => WebsiteBrowser;
  proposals: Map<string, WebsiteProposal>;
}
/** Only the trusted main process supplies observed website contents. */
export function installTeachingIPC(ctx: Context) {
  const { handle } = ctx,
    id = z.string().uuid(),
    sync = new AssignmentSyncService(ctx.repository);
  function proposal(proposalID: string) {
    const p = ctx.proposals.get(proposalID),
      repo = ctx.repository();
    if (!p || p.root !== repo.root || Date.now() - p.created > 15 * 60000)
      throw new Error('教学网站预览已过期，请重新读取');
    return p;
  }
  handle(
    'connectWebsite',
    z.tuple([id, id, z.boolean().optional()]),
    async (proposalID, courseID, includeHistory) => {
      const repo = ctx.repository(),
        p = proposal(proposalID),
        page = teachingPage.parse(p.result.data),
        source = teachingPageURL(p.result.url);
      if (page.kind !== 'course' || source.kind !== 'course' || source.id !== page.courseID)
        throw new Error('请先打开并读取课程首页以绑定课程');
      const current = await ctx.browser().inspect('teaching'),
        fresh = teachingPage.parse(current.data),
        url = teachingPageURL(current.url);
      if (
        fresh.kind !== 'course' ||
        url.kind !== 'course' ||
        url.id !== page.courseID ||
        fresh.accountID !== page.accountID ||
        fresh.courseID !== page.courseID
      )
        throw new Error('网页账号或课程已变化，请重新读取');
      return repo.withMutationGuard(
        () => {
          if (repo !== ctx.repository() || repo.snapshot().revision !== p.revision)
            throw new Error('资料库已变化，请重新读取课程页');
        },
        () =>
          repo.connectTeachingCourse({
            courseID,
            remoteCourseID: page.courseID,
            remoteTitle: page.title,
            accountID: page.accountID,
            includeHistory: includeHistory ?? false,
          }),
      );
    },
  );
  handle('previewWebsiteAssignment', z.tuple([id, id]), async (proposalID, connectionID) => {
    const repo = ctx.repository(),
      p = proposal(proposalID),
      page = teachingPage.parse(p.result.data),
      url = teachingPageURL(p.result.url);
    if (page.kind !== 'assign' || url.kind !== 'assign') throw new Error('请打开具体作业页面');
    const activity = [...ctx.proposals.values()]
      .reverse()
      .filter((p) => p.root === repo.root && Date.now() - p.created < 15 * 60000)
      .flatMap((p) => {
        const parsed = teachingPage.safeParse(p.result.data);
        if (
          !parsed.success ||
          parsed.data.kind !== 'course' ||
          parsed.data.accountID !== page.accountID ||
          parsed.data.courseID !== page.courseID
        )
          return [];
        const source = teachingPageURL(p.result.url);
        return source.kind === 'course' && source.id === page.courseID
          ? parsed.data.activities
          : [];
      })
      .find((a) => a.kind === 'assign' && a.id === url.id);
    if (!activity) throw new Error('请先读取该课程首页，再打开作业条目，以核对来源与章节');
    if (repo.snapshot().revision !== p.revision)
      throw new Error('本地资料已变化，请重新读取作业页');
    return sync.preview(connectionID, activity, page, p.result.url);
  });
  handle('applyWebsiteAssignment', z.tuple([id]), async (proposalID) => {
    const current = await ctx.browser().inspect('teaching');
    return sync.apply(proposalID, current.data, current.url);
  });
  handle('disconnectWebsite', z.tuple([id]), (connectionID) =>
    ctx.repository().disconnectTeachingWebsite(connectionID),
  );
  handle(
    'updateWebsiteOptions',
    z.tuple([
      id,
      z
        .object({
          includeMaterials: z.boolean().optional(),
          includeAssignments: z.boolean().optional(),
          includeExperiments: z.boolean().optional(),
          includeHistory: z.boolean().optional(),
        })
        .strict(),
    ]),
    (connectionID, flags) => ctx.repository().updateTeachingOptions(connectionID, flags),
  );
  handle(
    'resolveWebsiteDeadline',
    z.tuple([id, z.string().min(1).max(4000), z.boolean(), z.string().min(1).max(100)]),
    (connectionID, key, useWebsite, revision) =>
      sync.resolveDeadline(connectionID, key, useWebsite, revision),
  );
  return () => sync.clear();
}
