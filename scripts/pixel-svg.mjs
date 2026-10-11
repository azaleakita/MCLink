import { createRequire } from 'node:module';
const require = createRequire(new URL('../bridge/package.json', import.meta.url));
const { PNG } = require('pngjs');

// Merge identical pixel runs and rows. SVG consists of colored vector paths;
// it contains no embedded bitmap, and keeps the source pixel geometry.
export function rasterRectangles({ width, height, data }) {
  const rectangles = [];
  let active = new Map();
  for (let y = 0; y < height;) {
    const row = data.subarray(y * width * 4, (y + 1) * width * 4);
    let h = 1;
    while (y + h < height && row.equals(data.subarray((y + h) * width * 4, (y + h + 1) * width * 4))) h++;
    const next = new Map();
    for (let x = 0; x < width;) {
      const rgba = row.readUInt32BE(x * 4); let w = 1;
      while (x + w < width && row.readUInt32BE((x + w) * 4) === rgba) w++;
      if ((rgba & 255) !== 0) {
        const key = `${x}:${w}:${rgba}`;
        const before = active.get(key);
        if (before && before.y + before.h === y) { before.h += h; next.set(key, before); }
        else { const rectangle = { x, y, w, h, rgba }; rectangles.push(rectangle); next.set(key, rectangle); }
      }
      x += w;
    }
    active = next; y += h;
  }
  return rectangles;
}
export function pngToSvg(bytes) {
  const png = PNG.sync.read(bytes);
  if (png.width > 8192 || png.height > 8192 || png.width * png.height > 32 * 1024 * 1024) throw new Error('Icon exceeds pixel limit');
  return compactSvg(pixelsToSvg(png));
}
function pixelsToSvg(png) {
  const paths = new Map();
  for (const r of rasterRectangles(png)) {
    const path = `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`;
    paths.set(r.rgba, (paths.get(r.rgba) || '') + path);
  }
  const body = [...paths].map(([rgba, path]) => {
    const color = (rgba >>> 8).toString(16).padStart(6, '0');
    const alpha = rgba & 255;
    return `<path fill="#${color}"${alpha === 255 ? '' : ` fill-opacity="${(alpha / 255).toFixed(6)}"`} d="${path}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 ${png.width} ${png.height}">${body}</svg>\n`;
}
// Dense high-resolution source art is sampled at its actual 64px UI size.
// Work from our generated vector rectangles, without requiring another download.
export function compactSvg(svg) {
  if (Buffer.byteLength(svg) <= 256 * 1024) return svg;
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
  const png = { width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4) };
  for (const [, color, opacity, path] of svg.matchAll(/<path fill="#([0-9a-f]{6})"(?: fill-opacity="([0-9.]+)")? d="([^"]*)"\/>/g)) {
    const rgba = ((parseInt(color, 16) << 8) | Math.round((opacity === undefined ? 1 : Number(opacity)) * 255)) >>> 0;
    for (const [, x0, y0, w0, h0] of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
      const left = Math.max(0, Math.ceil(Number(x0) * 64 / width - 0.5));
      const right = Math.min(64, Math.ceil((Number(x0) + Number(w0)) * 64 / width - 0.5));
      const top = Math.max(0, Math.ceil(Number(y0) * 64 / height - 0.5));
      const bottom = Math.min(64, Math.ceil((Number(y0) + Number(h0)) * 64 / height - 0.5));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) png.data.writeUInt32BE(rgba, (y * 64 + x) * 4);
    }
  }
  return pixelsToSvg(png).replace('</svg>', '<!-- Dense source sampled to 64px UI size. --></svg>');
}
