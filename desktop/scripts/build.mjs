import {build} from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('dist-electron',{recursive:true});
await build({entryPoints:['electron/main/index.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:'dist-electron/main.cjs',external:['electron'],sourcemap:true});
await build({entryPoints:['electron/preload/index.ts'],bundle:true,platform:'node',target:'node22',format:'cjs',outfile:'dist-electron/preload.cjs',external:['electron']});
await fs.cp('electron/services/website/scripts','dist-electron/website-scripts',{recursive:true});
