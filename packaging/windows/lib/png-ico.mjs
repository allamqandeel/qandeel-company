/**
 * Minimal, dependency-free PNG decoding and Windows ICO assembly for the Desktop product icon (D1, D-D1-03).
 * Pure JavaScript on Node's own zlib: 8-bit RGB / RGBA, non-interlaced PNGs (what Chromium's screenshot writes).
 */
import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes a PNG to { width, height, rgba } (rgba: Buffer, 4 bytes per pixel, top-down). */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || !buf.subarray(0, 8).equals(SIG)) throw new Error('PNG_INVALID');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) throw new Error('PNG_UNSUPPORTED');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error('PNG_FILTER_INVALID');
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp];
      out[o + 1] = cur[x * bpp + 1];
      out[o + 2] = cur[x * bpp + 2];
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, rgba: out };
}

/** A 32-bit BGRA DIB icon image (BITMAPINFOHEADER, bottom-up, double height, all-zero AND mask). */
function dibEntry({ width, height, rgba }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = ((height - 1 - y) * width + x) * 4;
      const d = (y * width + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  const maskStride = Math.ceil(width / 32) * 4;
  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * height)]);
}

/**
 * Assembles an .ico from exact-size PNG renders: 256 px stays PNG-compressed (Vista+), smaller sizes become 32-bit
 * DIB entries (what every Windows shell surface and Inno Setup read). Entries are ordered by size.
 */
export function buildIco(pngsBySize) {
  const sizes = Object.keys(pngsBySize).map(Number).sort((a, b) => a - b);
  const images = sizes.map((n) => {
    const png = pngsBySize[n];
    const img = decodePng(png);
    if (img.width !== n || img.height !== n) throw new Error(`ICON_SIZE_MISMATCH ${n}`);
    return n >= 256 ? png : dibEntry(img);
  });
  const dir = Buffer.alloc(6 + 16 * sizes.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(sizes.length, 4);
  let offset = dir.length;
  sizes.forEach((n, i) => {
    const e = 6 + 16 * i;
    dir[e] = n >= 256 ? 0 : n;
    dir[e + 1] = n >= 256 ? 0 : n;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([dir, ...images]);
}

/** Reads an .ico directory: [{ size, bytes, png }] (used by the packaging proofs). */
export function readIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('ICO_INVALID');
  const n = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i;
    const size = buf[e] === 0 ? 256 : buf[e];
    const bytes = buf.readUInt32LE(e + 8);
    const at = buf.readUInt32LE(e + 12);
    if (at + bytes > buf.length) throw new Error('ICO_INVALID');
    out.push({ size, bytes, png: buf.subarray(at, at + 8).equals(SIG) });
  }
  return out;
}

/** Mean and max per-channel absolute difference of two equal-size RGBA images (alpha ignored). */
export function imageDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return { mean: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.rgba[i + c] - b.rgba[i + c]);
      sum += d;
      if (d > max) max = d;
    }
  }
  return { mean: sum / ((a.rgba.length / 4) * 3), max };
}
