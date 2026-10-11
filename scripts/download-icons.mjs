import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { pngToSvg } from './pixel-svg.mjs';
const require = createRequire(new URL('../bridge/package.json', import.meta.url));
const data = require('minecraft-data');
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(project, 'src', 'MCLink.App', 'Assets');
const root = 'https://ccvaults.com';
const exists = path => access(path).then(() => true, () => false);
const normalize = file => file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Icon source HTTP ${response.status}`);
  return response;
}
async function catalog() {
  const saved = process.argv.find(a => a.startsWith('--catalog='))?.slice(10);
  if (saved) return JSON.parse(await readFile(saved, 'utf8'))[1].files;
  const html = await (await request(root + '/')).text();
  const jsPath = /src="([^"]*static\/js\/index\.[^"]+\.js)"/.exec(html)?.[1];
  if (!jsPath) throw new Error('The public icon website changed its catalog loader. Use --catalog=file.json.');
  const js = await (await request(new URL(jsPath, root))).text();
  // Same public visitor bootstrap used by the source website, kept in memory only.
  const publicKey = /const e="([A-Za-z0-9]{20,})",a=await [a-zA-Z0-9_.]+\.post\("\/api\/token"/.exec(js)?.[1];
  if (!publicKey) throw new Error('The icon website changed its public access flow.');
  const tokenData = await (await request(root + '/api/token', { method: 'POST', headers: { 'x-api-key': publicKey, 'Content-Type': 'application/json', Origin: root, Referer: root + '/' }, body: '{}' })).json();
  const records = await (await request(root + '/api/assets/all', { headers: { Authorization: `Bearer ${tokenData.token}` } })).json();
  return records[1].files;
}
const files = await catalog();
const registryNames = new Set(['1.16.5', '1.20.1', '1.21.11'].flatMap(v => data(v).itemsArray.map(i => i.name)));
const selected = new Map();
for (const category of ['10. Items', '20. Blocks', '40. Weapons']) for (const f of files) {
  const name = normalize(f.file);
  if (f.category === category && f.file.endsWith('.png') && registryNames.has(name) && !selected.has(name)) selected.set(name, { ...f, name, directory: 'ItemIcons' });
}
const ui = { Heart_Full: 'health', Heart_Half: 'health_half', Food_Full: 'food', Armor_Full: 'armor', Map_Player: 'player', Icon_Search: 'search', Map_Marker: 'marker', Map_X: 'target' };
for (const [original, name] of Object.entries(ui)) {
  const f = files.find(f => f.file === `${original}.png` && f.category === '60. Interface');
  if (f) selected.set('ui:' + name, { ...f, name, directory: 'UI' });
}
for (const [itemName, uiName] of Object.entries({ filled_map: 'world_map', compass: 'connection', crafting_table: 'dashboard', redstone: 'model', clock: 'settings', book: 'help', chest: 'inventory', sunflower: 'dimension' })) {
  const f = selected.get(itemName); if (f) selected.set('ui:' + uiName, { ...f, name: uiName, directory: 'UI' });
}
await mkdir(join(output, 'ItemIcons'), { recursive: true }); await mkdir(join(output, 'UI'), { recursive: true });
let cursor = 0, completed = 0, failures = [];
const records = [...selected.values()];
async function worker() {
  while (cursor < records.length) {
    const record = records[cursor++], target = join(output, record.directory, record.name + '.svg');
    record.sourceUrl = root + '/assets/' + [record.category, record.subcategory, record.file].filter(Boolean).map(encodeURIComponent).join('/');
    try {
      if (!(await exists(target))) {
        const image = Buffer.from(await (await request(record.sourceUrl)).arrayBuffer());
        await writeFile(target, pngToSvg(image));
      }
      completed++;
      if (completed % 100 === 0) process.stdout.write(`Icons ${completed}/${records.length}\n`);
    } catch (error) { failures.push({ name: record.name, error: error.message }); }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const imported = [];
for (const r of records) if (await exists(join(output, r.directory, r.name + '.svg'))) imported.push(r);
const missing = [...registryNames].filter(n => n !== 'air' && !imported.some(r => r.directory === 'ItemIcons' && r.name === n));
await writeFile(join(output, 'icon-manifest.json'), JSON.stringify({ source: 'https://mcicons.ccleaf.com/', resolvedSource: root, converted: 'PNG pixels merged into SVG vector paths; dense source art sampled to 64px UI size', generatedAt: new Date().toISOString(), itemCount: imported.filter(r => r.directory === 'ItemIcons').length, uiCount: imported.filter(r => r.directory === 'UI').length, records: imported, missing, failures }, null, 2));
process.stdout.write(JSON.stringify({ imported: imported.length, missing: missing.length, failures: failures.length }) + '\n');
if (failures.length) process.exitCode = 1;
