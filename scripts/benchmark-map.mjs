import { createRequire } from 'node:module';
import { mkdtemp, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MapCache, scanSurface } from '../bridge/src/map-cache.mjs';
const require = createRequire(new URL('../bridge/package.json', import.meta.url));
const version = '1.21.11', registry = require('minecraft-data')(version), Chunk = require('prismarine-chunk')(version), { Vec3 } = require('vec3');
const chunk = new Chunk({ minY: -64, worldHeight: 384 });
for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
  const top = 48 + (x * 5 + z * 7) % 96;
  for (let y = -64; y <= top; y++) chunk.setBlockStateId(new Vec3(x, y, z), registry.blocksByName[y === top ? 'grass_block' : 'stone'].defaultState);
}
await scanSurface(chunk, registry, 0, 0);
const dir = await mkdtemp(join(tmpdir(), 'mclink-benchmark-')), map = new MapCache(dir);
try {
  await map.activate({ worldId: 'benchmark' }); const samples = [], slices = [];
  const started = performance.now();
  for (let z = -2; z <= 2; z++) for (let x = -2; x <= 2; x++) {
    const entry = await scanSurface(chunk, registry, x, z); samples.push(entry.activeMs); slices.push(entry.maxSliceMs); map.store(entry);
  }
  await map.flush(); const total = performance.now() - started;
  const before = performance.now(); const view = await map.snapshot({ size: 256, resolution: 128 }); const viewMs = performance.now() - before;
  const files = (await readdir(map.folder)).filter(f => f.endsWith('.gz'));
  const bytes = (await Promise.all(files.map(async f => (await stat(join(map.folder, f))).size))).reduce((a,b) => a+b, 0);
  samples.sort((a,b)=>a-b);
  console.log(JSON.stringify({ version, chunks: samples.length, scanMedianMs: samples[Math.floor(samples.length/2)], scanMaxMs: Math.max(...samples), longestSliceMs: Math.max(...slices), scanAndFlush25Ms: total, view128Ms: viewMs, compressed25Bytes: bytes, mapTransferBytes: JSON.stringify(view).length, memoryChunks: map.entries.size }, null, 2));
} finally { await map.close(); await rm(dir, { recursive:true, force:true }); }
