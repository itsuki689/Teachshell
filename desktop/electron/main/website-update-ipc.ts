import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { Repository } from '../services/storage/repository.ts';
import type { WebsiteBrowser } from '../services/website/browser.ts';
import { TeachingBatchService } from '../services/website/batch-sync.ts';

interface Context {
  handle: (name: string, args: z.ZodType, fn: (...args: any[]) => unknown) => void;
  repository: () => Repository;
  browser: () => WebsiteBrowser;
  cacheRoot: string;
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
    async (input) => {
      const repo = ctx.repository();
      const review = await batch.check(input);
      if (repo !== ctx.repository()) throw new Error('资料库已切换，请重新检查');
      return review;
    },
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
    async (input) => {
      const repo = ctx.repository();
      const result = await batch.apply(input);
      if (repo !== ctx.repository()) throw new Error('资料库已切换，请重新检查');
      return result;
    },
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
  return () => {
    versions.clear();
    batch.clear();
  };
}
