import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { pngToSvg, rasterRectangles, compactSvg } from '../../scripts/pixel-svg.mjs';
test('SVG conversion merges rectangles while preserving every visible pixel and alpha', () => {
  const png = new PNG({ width: 6, height: 5 });
  for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) png.data.writeUInt32BE(x < 3 ? 0xff2233ff : y < 2 ? 0x2233ff80 : 0, (y * 6 + x) * 4);
  const decoded = PNG.sync.read(PNG.sync.write(png));
  const rectangles = rasterRectangles(decoded);
  assert.equal(rectangles.length, 2);
  const reconstructed = Buffer.alloc(decoded.data.length);
  for (const r of rectangles) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) reconstructed.writeUInt32BE(r.rgba, (y * 6 + x) * 4);
  assert.deepEqual(reconstructed, decoded.data);
  const svg = pngToSvg(PNG.sync.write(png));
  assert.match(svg, /viewBox="0 0 6 5"/); assert.match(svg, /fill-opacity/); assert.doesNotMatch(svg, /<image|data:image/);
});
test('dense SVG vectors compact to the 64px display grid with correct color and alpha', () => {
  const path = '<path fill="#ff0000" d="M0 0h512v1024h-512z"/><path fill="#0000ff" fill-opacity="0.5" d="M512 0h512v1024h-512z"/>';
  const source = `<svg viewBox="0 0 1024 1024">${path}<!--${'padding'.repeat(40000)}--></svg>`;
  const result = compactSvg(source);
  assert.ok(result.length < 1000); assert.match(result,/viewBox="0 0 64 64"/);
  assert.match(result,/fill="#ff0000"/); assert.match(result,/fill="#0000ff" fill-opacity="0.501961"/);
  assert.match(result,/M32 0h32v64/);
});
test('bundled icon manifest records source URLs and includes essential item and UI vectors', async () => {
  const assets = new URL('../../src/MCLink.App/Assets/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('icon-manifest.json', assets)));
  assert.equal(manifest.failures.length, 0); assert.ok(manifest.itemCount >= 1400);
  for (const [dir, name] of [['ItemIcons', 'apple'], ['ItemIcons', 'diamond_pickaxe'], ['UI', 'health'], ['UI', 'player']]) {
    assert.match(await readFile(new URL(`${dir}/${name}.svg`, assets), 'utf8'), /^<svg/);
    assert.ok(manifest.records.find(r => r.directory === dir && r.name === name)?.sourceUrl.startsWith('https://ccvaults.com/assets/'));
  }
});
