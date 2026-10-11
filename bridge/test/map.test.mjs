import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import chunkLoader from 'prismarine-chunk';
import minecraftData from 'minecraft-data';
import anvil from 'prismarine-provider-anvil';
import nbt from 'prismarine-nbt';
import { Vec3 } from 'vec3';
import { MapCache, scanSurface, worldKey } from '../src/map-cache.mjs';

async function cacheFor(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'mclink-map-'));
  const cache = new MapCache(dir, () => {}, options);
  t.after(async () => { await cache.close(); await rm(dir, { recursive: true, force: true }); });
  await cache.activate({ worldId: 'test' }); return { cache, dir };
}
async function until(predicate) { for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(10); } throw Error('Timed out'); }
function terrain(version, modern = false) {
  const registry = minecraftData(version), Chunk = chunkLoader(version);
  const chunk = modern ? new Chunk({ minY: -64, worldHeight: 384 }) : new Chunk();
  const y = modern ? -30 : 64;
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunk.setBlockStateId(new Vec3(x, y, z), registry.blocksByName.grass_block.defaultState);
  chunk.setBlockStateId(new Vec3(4, y + 1, 7), registry.blocksByName.water.defaultState);
  return { chunk, registry, y };
}
test('surface scan supports old and modern worlds including negative Y, water and cancellation', async () => {
  for (const [version, modern] of [['1.16.5', false], ['1.21.11', true]]) {
    const { chunk, registry, y } = terrain(version, modern);
    const entry = await scanSurface(chunk, registry, -1, -2);
    assert.equal(entry.heights[0], y);
    assert.equal(entry.names[entry.ids[7 * 16 + 4]], 'water');
    assert.equal(entry.heights[7 * 16 + 4], y + 1);
    assert.equal(await scanSurface(chunk, registry, 0, 0, 'overworld', () => true), null);
  }
});
test('compressed tiles and trail survive restart; negative coordinates map correctly; worlds and dimensions remain separate', async t => {
  const { cache, dir } = await cacheFor(t);
  const { chunk, registry } = terrain('1.16.5');
  cache.store(await scanSurface(chunk, registry, -1, -1));
  cache.track({ entity: { position: new Vec3(-8, 65, -8) }, game: { dimension: 'overworld' } });
  cache.track({ entity: { position: new Vec3(-7.7, 65, -8) }, game: { dimension: 'overworld' } });
  await cache.flush();
  const resumed = new MapCache(dir);
  await resumed.activate({ worldId: 'test' });
  const map = await resumed.snapshot({ centerX: -8, centerZ: -8, size: 64, resolution: 64 });
  assert.equal(map.chunks, 1); assert.equal(map.trail.length, 1); assert.equal(map.position.x, -7.7);
  assert.equal(Buffer.from(map.heights, 'base64').readInt16LE((32 * 64 + 32) * 2), 64);
  assert.equal(Buffer.from(map.pixels, 'base64').length, 64 * 64 * 4);
  await resumed.activate({ worldId: 'test' }, 'minecraft:the_nether'); assert.equal(resumed.status().chunks, 0);
  await resumed.activate({ worldId: 'other' }); assert.equal(resumed.status().chunks, 0);
  assert.equal(worldKey({ worldId: 'test', port: 100 }), worldKey({ worldId: 'test', port: 200 }));
  assert.notEqual(worldKey({ port: 100 }), worldKey({ port: 200 }));
  await assert.rejects(resumed.activate({}, '../../escape'));
  await assert.rejects(resumed.snapshot({ centerX: NaN }));
  await resumed.close();
});
test('tile overwrites serialize and memory limit evicts summaries without losing disk cache', async t => {
  const { cache } = await cacheFor(t, { maxMemoryChunks: 2 });
  const { chunk, registry } = terrain('1.16.5');
  const entry = await scanSurface(chunk, registry, 0, 0);
  for (let i = 0; i < 8; i++) cache.store({ ...entry, heights: Array(256).fill(i) });
  cache.store({ ...entry, cx: 1 }); cache.store({ ...entry, cx: 2 });
  await cache.flush(); assert.equal(cache.entries.size, 2); assert.equal(cache.diskKeys.size, 3);
  assert.equal((await cache.load(0, 0)).heights[0], 7);
  const corrupt = join(cache.folder, '0,0.json.gz');
  await writeFile(corrupt, 'bad gzip'); cache.entries.clear();
  assert.equal(await cache.load(0, 0), null);
});
test('rapid dimension switches serialize and a map request waits for the final activation', async t => {
  const { cache } = await cacheFor(t);
  const first = cache.activate({ worldId: 'test' }, 'the_nether');
  const second = cache.activate({ worldId: 'test' }, 'the_end');
  const view = cache.snapshot({ size: 64, resolution: 64 });
  await Promise.all([first, second]);
  assert.equal((await view).dimension, 'the_end');
  assert.ok(cache.folder.endsWith('the_end')); assert.equal(cache.switching, false);
});
test('live block updates rescan a chunk and take priority over imported terrain', async t => {
  const { cache } = await cacheFor(t);
  const { chunk, registry } = terrain('1.16.5');
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 65, 0) }, world: { getColumn: () => chunk, getColumns: () => [{ chunkX: 0, chunkZ: 0 }] } });
  cache.bind(bot, { worldId: 'test' }); await cache.beginDimension(bot); await until(() => !cache.pumping);
  chunk.setBlockStateId(new Vec3(2, 70, 2), registry.blocksByName.oak_log.defaultState);
  bot.emit('blockUpdate', null, { position: new Vec3(2, 70, 2) }); await until(() => !cache.pumping);
  assert.equal(cache.entries.get('0,0').heights[34], 70);
});
for (const [version, modern] of [['1.16.5', false], ['1.21.11', true]]) test(`readonly Anvil import ${version} auto-detects version/seed and preserves source bytes and mtime`, { timeout: 15000 }, async t => {
  const { cache, dir } = await cacheFor(t);
  const source = join(dir, 'source'); await mkdir(join(source, 'region'), { recursive: true });
  const { chunk, y } = terrain(version, modern);
  const Provider = anvil.Anvil(version), provider = new Provider(join(source, 'region'));
  await provider.save(-1, -1, chunk); await provider.close();
  const metadata = { type: 'compound', name: '', value: { Data: { type: 'compound', value: { Version: { type: 'compound', value: { Name: { type: 'string', value: version } } }, RandomSeed: { type: 'long', value: [0, 12345] } } } } };
  await writeFile(join(source, 'level.dat'), gzipSync(nbt.writeUncompressed(metadata)));
  const region = join(source, 'region', 'r.-1.-1.mca'), bytes = await readFile(region), info = await stat(region);
  const hash = value => createHash('sha256').update(value).digest('hex');
  await cache.startImport({ path: source, dimension: 'overworld', centerX: -8, centerZ: -8, radius: 64 });
  await until(() => cache.importProgress?.state === 'completed' || cache.importProgress?.state === 'error');
  assert.equal(cache.importProgress.state, 'completed', JSON.stringify(cache.importProgress));
  assert.equal(cache.importProgress.errors, 0, JSON.stringify(cache.importProgress));
  assert.equal(cache.importProgress.loaded, 1); assert.equal(cache.importProgress.seed, '12345');
  assert.equal(cache.entries.get('-1,-1').heights[0], y);
  assert.equal(hash(await readFile(region)), hash(bytes)); assert.equal((await stat(region)).mtimeMs, info.mtimeMs);
});
test('missing save and invalid radius report an import error; worker can be stopped', async t => {
  const { cache, dir } = await cacheFor(t);
  await cache.startImport({ path: join(dir, 'missing'), dimension: 'overworld' });
  await until(() => cache.importProgress?.state === 'error');
  await until(() => !cache.importWorker);
  assert.match(cache.importProgress.message, /ENOENT/);
  await mkdir(join(dir, 'region'));
  await cache.startImport({ path: dir, dimension: 'overworld', version: '1.21.11', radius: 10 });
  await until(() => cache.importProgress?.state === 'error');
  assert.match(cache.importProgress.message, /范围无效/);
  await until(() => !cache.importWorker);
  await cache.startImport({ path: dir, dimension: 'overworld' }); await cache.stopImport();
  assert.equal(cache.importProgress.state, 'stopped');
});
