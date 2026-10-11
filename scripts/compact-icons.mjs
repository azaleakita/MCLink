import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { compactSvg } from './pixel-svg.mjs';
const root = new URL('../src/MCLink.App/Assets/', import.meta.url);
let before = 0, after = 0, compacted = 0;
for (const folder of ['ItemIcons', 'UI']) {
  const directory = new URL(folder + '/', root);
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.svg')) continue;
    const file = new URL(name, directory), size = (await stat(file)).size; before += size;
    if (size > 256 * 1024) {
      const output = compactSvg(await readFile(file, 'utf8'));
      await writeFile(file, output); compacted++; after += Buffer.byteLength(output);
    } else after += size;
  }
}
const file = new URL('icon-manifest.json', root), manifest = JSON.parse(await readFile(file));
manifest.optimization = { maxDetailedBytes: 256 * 1024, denseRasterSize: 64, compacted, beforeBytes: before, afterBytes: after };
manifest.converted = 'PNG pixels merged into SVG vector paths; dense source art sampled to 64px UI size';
await writeFile(file, JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest.optimization));
