import { parentPort, workerData } from 'node:worker_threads';
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createRequire } from 'node:module';
import { inflateSync, gunzipSync } from 'node:zlib';
import nbt from 'prismarine-nbt';
import minecraftData from 'minecraft-data';
import { scanSurface, dimensionName } from './map-cache.mjs';
const require = createRequire(import.meta.url);

// Read source saves strictly with 'r'. The provider's normal API opens r+/w+,
// so use only its pinned NBT-to-chunk converter, never its file writer.
export async function readRegionChunk(file, location, fileSize) {
  const sector = location >>> 8, sectors = location & 255;
  if (sector < 2 || sectors === 0 || (sector + sectors) * 4096 > fileSize) throw new Error('区块扇区位置无效。');
  const header = Buffer.alloc(5); const result = await file.read(header, 0, 5, sector * 4096);
  if (result.bytesRead !== 5) throw new Error('区块头不完整。');
  const length = header.readUInt32BE(0), compression = header[4];
  if (length < 2 || length + 4 > sectors * 4096 || length > 1024 * 1024) throw new Error('区块长度无效。');
  if (compression & 128) throw new Error('此区块使用外部 .mcc 文件，当前导入器不支持。');
  const bytes = Buffer.alloc(length - 1); const body = await file.read(bytes, 0, bytes.length, sector * 4096 + 5);
  if (body.bytesRead !== bytes.length) throw new Error('区块内容不完整。');
  const decoded = compression === 1 ? gunzipSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }) : compression === 2 ? inflateSync(bytes, { maxOutputLength: 16 * 1024 * 1024 }) : compression === 3 ? bytes : null;
  if (!decoded) throw new Error('不支持此区块压缩格式。');
  return nbt.parseUncompressed(decoded);
}

async function run() {
  if (!workerData.path || typeof workerData.path !== 'string') throw new Error('请选择 Minecraft 存档目录。');
  const root = await realpath(workerData.path), dimension = dimensionName(workerData.dimension);
  const folder = basename(root).toLowerCase() === 'region' ? root : join(root, dimension === 'the_nether' ? 'DIM-1' : dimension === 'the_end' ? 'DIM1' : '', 'region');
  if (!(await stat(folder)).isDirectory()) throw new Error('所选目录中找不到 region 文件夹。');
  let version = workerData.version?.trim(), seed = null;
  try {
    const metadata = nbt.simplify((await nbt.parse(await readFile(join(root, 'level.dat')))).parsed).Data;
    version ||= metadata.Version?.Name;
    const value = metadata.WorldGenSettings?.seed ?? metadata.RandomSeed;
    if (typeof value === 'bigint') seed = value.toString();
    else if (Array.isArray(value) && value.length === 2) seed = BigInt.asIntN(64, (BigInt(value[0] >>> 0) << 32n) | BigInt(value[1] >>> 0)).toString();
    else if (value !== undefined) seed = String(value);
  } catch { /* A region-only import can specify the version manually. */ }
  if (!version) throw new Error('无法自动识别存档版本，请填写版本，例如 1.21.11。');
  const registry = minecraftData(version); if (!registry) throw new Error('不支持此存档版本。');
  const { nbtChunkToPrismarineChunk } = require('prismarine-provider-anvil').chunk(version);
  const files = (await readdir(folder)).filter(f => /^r\.-?\d+\.-?\d+\.mca$/.test(f));
  const radius = workerData.radius ?? 256, centerX = workerData.centerX ?? 0, centerZ = workerData.centerZ ?? 0;
  if (!Number.isInteger(radius) || radius < 32 || radius > 1024 || ![centerX, centerZ].every(Number.isFinite)) throw new Error('导入中心或范围无效。');
  let total = 0, loaded = 0, errors = 0, skipped = 0, lastError = '';
  const status = state => ({ type: 'progress', state, total, loaded, errors, skipped, seed, version, message: state === 'completed' ? `导入完成：${loaded} 个区块，${errors} 个区块无法读取。` : `正在导入 ${loaded}/${total} 个区块…`, ...(lastError ? { lastError } : {}) });
  for (const name of files) {
    const [, rx, rz] = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name).map((v, i) => i ? Number(v) : v);
    if (Math.abs(rx * 512 + 256 - centerX) > radius + 256 || Math.abs(rz * 512 + 256 - centerZ) > radius + 256) continue;
    const file = await open(join(folder, name), 'r');
    try {
      const fileSize = (await file.stat()).size, header = Buffer.alloc(4096);
      if ((await file.read(header, 0, 4096, 0)).bytesRead !== 4096) throw new Error('区域头不完整。');
      const targets = [];
      for (let i = 0; i < 1024; i++) {
        const location = header.readUInt32BE(i * 4), cx = rx * 32 + i % 32, cz = rz * 32 + Math.floor(i / 32);
        if (!location) continue;
        if (Math.abs(cx * 16 + 8 - centerX) > radius || Math.abs(cz * 16 + 8 - centerZ) > radius) { skipped++; continue; }
        targets.push({ location, cx, cz });
      }
      total += targets.length; parentPort.postMessage(status('running'));
      for (const target of targets) {
        try {
          const chunk = nbtChunkToPrismarineChunk(await readRegionChunk(file, target.location, fileSize));
          const entry = await scanSurface(chunk, registry, target.cx, target.cz, dimension);
          parentPort.postMessage({ type: 'chunk', entry }); loaded++;
        } catch (error) { errors++; lastError = String(error.message).slice(0, 300); }
        if ((loaded + errors) % 16 === 0) parentPort.postMessage(status('running'));
      }
    } finally { await file.close(); }
  }
  parentPort.postMessage(status('completed'));
}
if (parentPort) run().catch(error => parentPort.postMessage({ type: 'progress', state: 'error', message: error.message }));
