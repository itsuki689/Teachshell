/** Fail closed if a target, source revision, filename or artifact digest differs. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeReleaseManifests } from './release-manifest.mjs';
const output = path.resolve(process.argv[2] ?? 'release');
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const filenames = (await fs.readdir(output)).filter((n) => /^manifest-[a-z0-9-]+\.json$/.test(n));
const manifests = await Promise.all(
  filenames.map(async (n) => JSON.parse(await fs.readFile(path.join(output, n), 'utf8'))),
);
const merged = mergeReleaseManifests(manifests, version, commit),
  lines = [];
for (const target of merged.targets)
  for (const item of target.artifacts) {
    const file = path.join(output, item.name),
      hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== item.sha256 || (await fs.stat(file)).size !== item.size)
      throw new Error('Artifact changed: ' + item.name);
    lines.push(`${item.sha256}  ${item.name}`);
  }
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), lines.sort().join('\n') + '\n');
await fs.writeFile(
  path.join(output, 'release-manifest.json'),
  JSON.stringify(merged, null, 2) + '\n',
);
console.log(`Verified ${lines.length} assets for v${version} (${commit})`);
