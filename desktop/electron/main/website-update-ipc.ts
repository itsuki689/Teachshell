import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Repository } from '../services/storage/repository.ts';
import type { WebsiteBrowser } from '../services/website/browser.ts';
import { TeachingBatchService } from '../services/website/batch-sync.ts';
import type { BatchReview } from '../services/website/batch-sync.ts';
import { BackgroundTeachingSyncService } from '../services/website/background-sync.ts';
import type { BackgroundReadiness, BackgroundStatus } from '../services/website/background-sync.ts';

interface Context {
  handle: (name: string, args: z.ZodType, fn: (...args: any[]) => unknown) => void;
  repository: () => Repository;
  browser: () => WebsiteBrowser;
  cacheRoot: string;
  background?: {
    settingsRoot: string;
    readiness: () => BackgroundReadiness;
    onChange: (status: BackgroundStatus) => void;
  };
}

/** Remote pages never supply IPC arguments; only the trusted application can approve updates. */
export function installWebsiteUpdateIPC(ctx: Context) {
  const { handle } = ctx;
  const id = z.string().uuid();
  const rowID = z.string().min(1).max(8192);
  const revision = z.string().regex(/^[a-f0-9]{64}$/);
  const versions = new Map<
    string,
    { repo: Repository; currentID?: string; ids: Set<string>; revision: string; createdAt: number }
  >();
  const batch = new TeachingBatchService({
    repository: ctx.repository,
    transport: ctx.browser,
    cacheRoot: ctx.cacheRoot,
  });
  let review: BatchReview | undefined;
  let generation = 0;
  let active: Promise<unknown> | undefined;
  const background =
    ctx.background &&
    new BackgroundTeachingSyncService({
      ...ctx.background,
      repository: ctx.repository,
      batch,
      onChange: (status) => {
        review = status.review;
        ctx.background!.onChange(status);
      },
    });
  function foreground<T>(operation: () => Promise<T>): Promise<T> {
    if (active) return Promise.reject(new Error('教学网站操作正在进行，请稍候'));
    const current = generation;
    const task = Promise.resolve()
      .then(async () => {
        await background?.pauseForForeground();
        if (current !== generation) throw new Error('资料库已切换');
        return operation();
      })
      .finally(() => {
        active = undefined;
        if (current === generation) background?.resumeAfterForeground(review);
      });
    active = task;
    return task;
  }
  handle('websiteBackgroundStatus', z.tuple([]), () => {
    background?.notifyReadinessChanged();
    return background?.getStatus();
  });
  handle(
    'saveWebsiteBackground',
    z.tuple([
      z
        .object({
          enabled: z.boolean().optional(),
          intervalMinutes: z.number().int().min(5).max(1440).optional(),
        })
        .strict(),
    ]),
    (input) => background?.updatePreferences(input),
  );
  handle('discardWebsiteReview', z.tuple([]), () =>
    foreground(async () => {
      batch.clear();
      review = undefined;
    }),
  );
  handle(
    'checkWebsiteBatch',
    z.tuple([
      z
        .object({
          connectionIDs: z.array(id).min(1).max(100).optional(),
          includeExisting: z.boolean().optional(),
        })
        .strict()
        .optional(),
    ]),
    (input) =>
      foreground(async () => {
        const repo = ctx.repository();
        review = undefined;
        const result = await batch.check(input);
        if (repo !== ctx.repository()) throw new Error('资料库已切换，请重新检查');
        review = result;
        return result;
      }),
  );
  handle(
    'applyWebsiteBatch',
    z.tuple([
      z
        .object({
          reviewID: id,
          selectedIDs: z.array(rowID).min(1).max(5000),
          deadlineChoices: z
            .record(rowID, z.boolean())
            .refine((value) => Object.keys(value).length <= 5000)
            .optional(),
          adoptLocalFileIDs: z.array(rowID).max(5000).optional(),
        })
        .strict(),
    ]),
    (input) =>
      foreground(async () => {
        const repo = ctx.repository();
        const result = await batch.apply(input);
        if (repo !== ctx.repository()) throw new Error('资料库已切换，请重新检查');
        review = result.review;
        return result;
      }),
  );
  handle('cancelWebsiteBatch', z.tuple([]), () => batch.cancel());
  handle('listMaterialVersions', z.tuple([id]), async (materialID) => {
    const repo = ctx.repository();
    const result = await repo.listMaterialVersions(materialID);
    if (repo !== ctx.repository()) throw new Error('资料库已切换');
    for (const [key, value] of versions)
      if (Date.now() - value.createdAt > 15 * 60000) versions.delete(key);
    while (versions.size >= 100) versions.delete(versions.keys().next().value!);
    const proposalID = randomUUID();
    versions.set(proposalID, {
      repo,
      currentID: result.currentID,
      ids: new Set(result.versions.map((version) => version.id)),
      revision: result.revision,
      createdAt: Date.now(),
    });
    return { ...result, proposalID };
  });
  handle(
    'restoreMaterialVersion',
    z.tuple([id, id, revision, id]),
    async (currentID, versionID, expected, proposalID) => {
      const repo = ctx.repository();
      const proposal = versions.get(proposalID);
      const verify = () => {
        if (
          !proposal ||
          versions.get(proposalID) !== proposal ||
          proposal.repo !== repo ||
          repo !== ctx.repository() ||
          Date.now() - proposal.createdAt > 15 * 60000 ||
          proposal.currentID !== currentID ||
          !proposal.ids.has(versionID) ||
          proposal.revision !== expected
        )
          throw new Error('资料库或版本审核已变化，请重新读取版本列表');
      };
      verify();
      const result = await repo.withMutationGuard(verify, () =>
        repo.restoreMaterialVersion(currentID, versionID, expected),
      );
      if (repo !== ctx.repository()) throw new Error('资料库已切换');
      versions.delete(proposalID);
      return result;
    },
  );
  return Object.assign(
    async () => {
      generation++;
      versions.clear();
      await background?.stop();
      batch.clear();
      await active?.catch(() => {});
      review = undefined;
    },
    {
      start: () => background?.start(),
      notify: () => background?.notifyReadinessChanged(),
      foreground,
    },
  );
}
