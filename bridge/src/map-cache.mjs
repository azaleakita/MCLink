import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { setImmediate as yieldThread } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { Vec3 } from 'vec3';
const compress = promisify(gzip), decompress = promisify(gunzip);
const key = (x, z) => `${x},${z}`;
export const dimensionName = value => String(value || 'overworld').replace(/^minecraft:/, '');
export function worldKey(config = {}) {
  const identity = config.worldId?.trim() ? `world:${config.worldId.trim()}` : `server:${config.host || 'localhost'}:${config.port || 25565}`;
  return createHash('sha256').update(identity).digest('hex').slice(0, 20);
}

// Only store a compact 16x16 surface summary, never retain entire 3D chunks.
// Empty vertical sections are skipped. Yield between scan slices so bot physics stays responsive.
export async function scanSurface(chunk, registry, cx, cz, dimension = 'overworld', shouldCancel = () => false) {
  const started = performance.now(), minY = chunk.minY ?? 0, height = chunk.worldHeight ?? 256;
  const top = minY + height - 1, names = ['unloaded'], ids = Array(256).fill(0), heights = Array(256).fill(-32768);
  const palette = new Map([['unloaded', 0]]), stateNames = new Map();
  const point = new Vec3(0, top, 0);
  let sliceStart = performance.now(), activeMs = 0, maxSliceMs = 0;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    if (shouldCancel()) return null;
    point.x = x; point.z = z;
    for (let y = top; y >= minY; y--) {
      const section = chunk.sections?.[Math.floor((y - minY) / 16)];
      if (chunk.sections && (!section || section.solidBlockCount === 0)) { y = minY + Math.floor((y - minY) / 16) * 16; continue; }
      point.y = y;
      const state = chunk.getBlockStateId(point);
      let name = stateNames.get(state);
      if (name === undefined) { name = registry.blocksByStateId[state]?.name || 'unknown'; stateNames.set(state, name); }
      if (['air', 'cave_air', 'void_air', 'unknown'].includes(name)) continue;
      let id = palette.get(name);
      if (id === undefined) { id = names.length; names.push(name); palette.set(name, id); }
      const index = z * 16 + x; ids[index] = id; heights[index] = y; break;
    }
    if (performance.now() - sliceStart >= 4) {
      const elapsed = performance.now() - sliceStart; activeMs += elapsed; maxSliceMs = Math.max(maxSliceMs, elapsed);
      await yieldThread(); sliceStart = performance.now();
    }
  }
  const elapsed = performance.now() - sliceStart; activeMs += elapsed; maxSliceMs = Math.max(maxSliceMs, elapsed);
  return { cx, cz, dimension: dimensionName(dimension), names, ids, heights, updatedAt: Date.now(), activeMs, maxSliceMs, totalMs: performance.now() - started };
}

export function terrainColor(name) {
  if (name === 'unloaded') return [26, 49, 44];
  if (/lava|fire|magma|campfire/.test(name)) return [239, 145, 82];
  if (/water|bubble_column/.test(name)) return [69, 134, 183];
  if (/snow|ice/.test(name)) return [196, 218, 224];
  if (/sand|end_stone/.test(name)) return [205, 187, 133];
  if (/grass|moss|leaves|vine|fern/.test(name)) return [99, 151, 94];
  if (/netherrack|nether_wart/.test(name)) return [126, 68, 64];
  if (/log|wood|planks|chest|barrel/.test(name)) return [153, 123, 82];
  if (/dirt|farmland|mud/.test(name)) return [128, 102, 74];
  if (/ore|diamond|iron|gold|copper/.test(name)) return [146, 169, 174];
  if (/stone|bedrock|gravel|deepslate|andesite|diorite|granite|tuff/.test(name)) return [119, 131, 129];
  return [113, 143, 120];
}

export class MapCache {
  constructor(dataDir, emit = () => {}, options = {}) {
    this.dataDir = dataDir; this.emit = emit; this.maxMemoryChunks = options.maxMemoryChunks || 2048;
    this.worldId = ''; this.dimension = 'overworld'; this.entries = new Map(); this.diskKeys = new Set();
    this.missing = new Set(); this.loading = new Map(); this.pending = new Map(); this.writes = new Set(); this.writeByChunk = new Map(); this.switching = false;
    this.trails = new Map(); this.position = null; this.bot = null; this.epoch = 0; this.pumping = false; this.scanned = 0; this.scanMs = 0;
    this.importWorker = null; this.importProgress = null;
    this.activationTail = Promise.resolve();
  }
  activate(config = {}, dimension = 'overworld') {
    const work = this.activationTail.catch(() => {}).then(() => this.activateNow(config, dimension));
    this.activationTail = work; return work;
  }
  async activateNow(config, dimension) {
    const id = worldKey(config), dim = dimensionName(dimension);
    if (!/^[a-z0-9_-]{1,80}$/.test(dim)) throw new Error('暂不支持此维度名称，请选择主世界、下界或末地。');
    if (this.worldId === id && this.dimension === dim) return;
    this.switching = true; this.epoch++;
    try {
    await this.stopImport(); await this.flush();
    this.worldId = id; this.dimension = dim; this.folder = join(this.dataDir, 'maps', id, dim);
    this.entries.clear(); this.diskKeys.clear(); this.missing.clear(); this.loading.clear(); this.pending.clear(); this.trails.clear(); this.position = null;
    this.scanned = 0; this.scanMs = 0; this.importProgress = null;
    await mkdir(this.folder, { recursive: true });
    for (const name of await readdir(this.folder)) if (/^-?\d+,-?\d+\.json\.gz$/.test(name)) this.diskKeys.add(name.replace('.json.gz', ''));
    try { const meta = JSON.parse(await readFile(join(this.folder, 'trail.json'), 'utf8')); if (Array.isArray(meta.points)) { this.trails.set(dim, meta.points.slice(-1024)); this.position = meta.position || meta.points.at(-1) || null; } } catch { /* New map */ }
    } finally { this.switching = false; }
    this.publishStatus();
  }
  touch(entry) {
    const id = key(entry.cx, entry.cz); this.entries.delete(id); this.entries.set(id, entry);
    while (this.entries.size > this.maxMemoryChunks) this.entries.delete(this.entries.keys().next().value);
  }
  store(entry, source = 'protocol') {
    entry.source = source;
    this.touch(entry); const id = key(entry.cx, entry.cz); this.diskKeys.add(id); this.missing.delete(id);
    const destination = join(this.folder, `${id}.json.gz`), temporary = destination + '.tmp';
    const serialized = JSON.stringify(entry);
    const write = (this.writeByChunk.get(destination) || Promise.resolve()).catch(() => {}).then(() => compress(Buffer.from(serialized))).then(bytes => writeFile(temporary, bytes)).then(() => rename(temporary, destination));
    this.writeByChunk.set(destination, write); this.writes.add(write);
    write.catch(error => this.emit('map_error', { message: `地图缓存保存失败：${error.message}` })).finally(() => { this.writes.delete(write); if (this.writeByChunk.get(destination) === write) this.writeByChunk.delete(destination); });
  }
  async load(cx, cz) {
    const id = key(cx, cz), cached = this.entries.get(id);
    if (cached) { this.touch(cached); return cached; }
    if (this.missing.has(id) || !this.diskKeys.has(id)) return null;
    if (this.loading.has(id)) return this.loading.get(id);
    const epoch = this.epoch, folder = this.folder;
    const work = readFile(join(folder, `${id}.json.gz`)).then(decompress).then(bytes => {
      const entry = JSON.parse(bytes.toString());
      if (epoch !== this.epoch) return null;
      if (entry.cx !== cx || entry.cz !== cz || entry.ids?.length !== 256 || entry.heights?.length !== 256 || !Array.isArray(entry.names)) throw new Error('地图缓存格式无效');
      this.touch(entry); return entry;
    }).catch(() => { if (epoch === this.epoch) this.missing.add(id); return null; }).finally(() => this.loading.delete(id));
    this.loading.set(id, work); return work;
  }
  bind(bot, config) {
    this.bot = bot; this.config = config;
    this.onLoad = p => this.enqueue(Math.floor(p.x / 16), Math.floor(p.z / 16));
    this.onUpdate = (before, after) => { const p = after?.position || before?.position; if (p) this.onLoad(p); };
    bot.on('chunkColumnLoad', this.onLoad); bot.on('blockUpdate', this.onUpdate);
  }
  async beginDimension(bot) {
    await this.activate(this.config, bot.game.dimension);
    for (const column of bot.world.getColumns()) this.enqueue(Number(column.chunkX), Number(column.chunkZ));
    this.track(bot);
  }
  unbind() {
    if (this.bot) { this.bot.removeListener('chunkColumnLoad', this.onLoad); this.bot.removeListener('blockUpdate', this.onUpdate); }
    this.bot = null; this.pending.clear();
  }
  enqueue(cx, cz) {
    if (!this.folder || !this.bot || this.switching || dimensionName(this.bot.game?.dimension) !== this.dimension) return;
    this.pending.set(key(cx, cz), { cx, cz });
    if (!this.pumping) this.pump().catch(error => this.emit('map_error', { message: error.message }));
  }
  async pump() {
    this.pumping = true;
    try {
      while (this.pending.size && this.bot && !this.switching) {
        const [id, location] = this.pending.entries().next().value; this.pending.delete(id);
        const bot = this.bot, epoch = this.epoch, chunk = bot.world.getColumn(location.cx, location.cz);
        if (!chunk) continue;
        const entry = await scanSurface(chunk, bot.registry, location.cx, location.cz, this.dimension, () => epoch !== this.epoch || bot !== this.bot);
        if (entry && epoch === this.epoch && bot === this.bot) { this.store(entry); this.scanned++; this.scanMs = entry.activeMs; }
        await yieldThread();
      }
    } finally { this.pumping = false; this.publishStatus(); }
  }
  track(bot) {
    if (!bot?.entity || this.dimension !== dimensionName(bot.game.dimension)) return;
    const p = bot.entity.position;
    this.position = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10, dimension: this.dimension };
    const trail = this.trails.get(this.dimension) || [];
    const previous = trail.at(-1);
    if (!previous || Math.hypot(previous.x - p.x, previous.z - p.z) >= 1) {
      trail.push({ ...this.position, time: Date.now() }); if (trail.length > 1024) trail.shift(); this.trails.set(this.dimension, trail);
    }
  }
  status() { return { worldId: this.worldId, dimension: this.dimension, chunks: this.diskKeys.size, memoryChunks: this.entries.size, pending: this.pending.size, scanned: this.scanned, scanMs: Math.round(this.scanMs * 100) / 100, position: this.position, import: this.importProgress }; }
  publishStatus() { this.emit('map_status', this.status()); }
  async snapshot({ centerX, centerZ, size = 256, resolution = 128 } = {}) {
    await this.activationTail;
    if (!this.folder) throw new Error('请先连接世界，或在地图页载入地图缓存。');
    if (![64, 128, 256, 512].includes(size) || ![64, 128, 256].includes(resolution) || resolution > size) throw new Error('地图范围或分辨率不支持。');
    centerX ??= this.position?.x ?? 0; centerZ ??= this.position?.z ?? 0;
    if (![centerX, centerZ].every(v => Number.isFinite(v) && Math.abs(v) <= 30000000)) throw new Error('地图坐标无效。');
    const epoch = this.epoch, startX = Math.floor(centerX - size / 2), startZ = Math.floor(centerZ - size / 2), scale = size / resolution;
    const coords = [];
    for (let z = Math.floor(startZ / 16); z <= Math.floor((startZ + size - 1) / 16); z++) for (let x = Math.floor(startX / 16); x <= Math.floor((startX + size - 1) / 16); x++) coords.push([x, z]);
    // Limit file reads to avoid flooding OneDrive or the disk queue.
    for (let offset = 0; offset < coords.length; offset += 16) await Promise.all(coords.slice(offset, offset + 16).map(([x, z]) => this.load(x, z)));
    if (epoch !== this.epoch) throw new Error('地图世界已切换，请重新刷新。');
    const rgba = Buffer.alloc(resolution * resolution * 4), heights = Buffer.alloc(resolution * resolution * 2), ids = Buffer.alloc(resolution * resolution * 2);
    const legend = ['unloaded'], palette = new Map([['unloaded', 0]]);
    for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
      const wx = Math.floor(startX + x * scale), wz = Math.floor(startZ + z * scale), entry = this.entries.get(key(Math.floor(wx / 16), Math.floor(wz / 16)));
      const local = ((wz % 16 + 16) % 16) * 16 + ((wx % 16 + 16) % 16), index = z * resolution + x;
      const name = entry?.names[entry.ids[local]] || 'unloaded', height = entry?.heights[local] ?? -32768;
      let paletteId = palette.get(name); if (paletteId === undefined) { paletteId = legend.length; palette.set(name, paletteId); legend.push(name); }
      const color = terrainColor(name); const shade = name === 'unloaded' ? ((x + z) % 2 ? 0.95 : 1) : 1 + Math.max(-0.16, Math.min(0.16, ((height % 16 + 16) % 16 - 8) / 80));
      // WinUI WriteableBitmap expects BGRA pixels.
      rgba[index * 4] = Math.round(color[2] * shade); rgba[index * 4 + 1] = Math.round(color[1] * shade); rgba[index * 4 + 2] = Math.round(color[0] * shade); rgba[index * 4 + 3] = 255;
      heights.writeInt16LE(height, index * 2); ids.writeUInt16LE(paletteId, index * 2);
    }
    return { ...this.status(), width: resolution, height: resolution, startX, startZ, size, blocksPerPixel: scale, pixels: rgba.toString('base64'), heights: heights.toString('base64'), blockIds: ids.toString('base64'), legend, trail: this.trails.get(this.dimension) || [] };
  }
  async startImport(options) {
    await this.activationTail;
    if (this.importWorker) throw new Error('已有存档导入正在进行。');
    if (!this.folder) await this.activate(options, options.dimension || 'overworld');
    if (dimensionName(options.dimension) !== this.dimension) throw new Error('导入维度与当前地图不一致，请切换地图维度。');
    const epoch = this.epoch;
    const worker = new Worker(new URL('./map-import-worker.mjs', import.meta.url), { workerData: { ...options, dimension: this.dimension } });
    this.importWorker = worker; this.importProgress = { state: 'running', loaded: 0, total: 0, errors: 0 }; this.publishStatus();
    worker.on('message', message => {
      if (this.importWorker !== worker || epoch !== this.epoch) return;
      if (message.type === 'chunk') {
        // Currently loaded server chunks win; a stale protocol cache can be refreshed by a save.
        if (!this.bot?.world.getColumn(message.entry.cx, message.entry.cz)) this.store(message.entry, 'anvil');
      } else {
        this.importProgress = message; this.publishStatus();
        if (message.state === 'completed' || message.state === 'error') this.emit('map_import', message);
      }
    });
    worker.on('error', error => { this.importProgress = { state: 'error', message: error.message }; this.emit('map_import', this.importProgress); });
    worker.on('exit', () => { if (this.importWorker === worker) { this.importWorker = null; this.publishStatus(); } });
    return { started: true };
  }
  async stopImport() {
    const worker = this.importWorker; this.importWorker = null;
    if (worker) { await worker.terminate(); this.importProgress = { ...this.importProgress, state: 'stopped' }; this.publishStatus(); }
    return { stopped: true };
  }
  async flush() {
    while (this.writes.size) await Promise.allSettled([...this.writes]);
    if (this.folder) await writeFile(join(this.folder, 'trail.json'), JSON.stringify({ points: this.trails.get(this.dimension) || [], position: this.position }));
  }
  async close() { this.unbind(); await this.activationTail.catch(() => {}); await this.stopImport(); await this.flush(); }
}
