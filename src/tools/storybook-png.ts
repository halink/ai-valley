/** Offline, bounded PNG interchange for the asset pipeline, not a browser decoder.
 * Deliberately accepts only non-interlaced 8-bit RGBA exports. Never coerces other formats.
 */
import {createHash} from 'node:crypto';
import {deflateSync, inflateSync} from 'node:zlib';

export const PNG_LIMITS = Object.freeze({side: 4096, pixels: 16_777_216, bytes: 72_000_000});
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
export type RgbaImage = {width: number; height: number; pixels: Uint8Array};
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
function fail(reason: string): never {throw Error(`invalid_storybook_png: ${reason}`);}
function geometry(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > PNG_LIMITS.side || height > PNG_LIMITS.side || width * height > PNG_LIMITS.pixels) fail('dimensions');
}
export function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {crc ^= b; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);}
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4, 'ascii'); b.set(data, 8);
  b.writeUInt32BE(pngCrc(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
/** Deterministic serialization with no ancillary metadata, color conversion, trim or rotation. */
export function encodeRgbaPng(image: RgbaImage): Buffer {
  const {width, height, pixels} = image; geometry(width, height);
  if (pixels.length !== width * height * 4) fail('pixel_length');
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', new Uint8Array())]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Checks complete structure, every CRC, compressed-stream consumption and all five filters. */
export function decodeRgbaPng(input: Uint8Array): RgbaImage {
  if (input.length > PNG_LIMITS.bytes || input.length < 57) fail('byte_length');
  const bytes = Buffer.from(input);
  if (!bytes.subarray(0, 8).equals(signature)) fail('signature');
  let offset = 8, width = 0, height = 0, ended = false, idat = false, idatEnded = false;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail('truncated_chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail('truncated_chunk');
    const nameBytes = bytes.subarray(offset + 4, offset + 8), name = nameBytes.toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(name) || nameBytes.some(b => b > 127) || (nameBytes[2] & 32)) fail('chunk_name');
    const body = bytes.subarray(offset + 8, end - 4);
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail('crc');
    if (!width && name !== 'IHDR') fail('header_first');
    if (name === 'IHDR') {
      if (width || length !== 13) fail('header');
      width = body.readUInt32BE(0); height = body.readUInt32BE(4); geometry(width, height);
      if (body[8] !== 8 || body[9] !== 6 || body[10] || body[11] || body[12]) fail('requires_rgba8_noninterlaced');
    } else if (name === 'IDAT') {
      if (idatEnded) fail('noncontiguous_idat'); idat = true; compressed.push(body);
    } else if (name === 'IEND') {
      if (length || !idat || end !== bytes.length) fail('end'); ended = true; offset = end; break;
    } else {
      if (idat) idatEnded = true;
      // Whitelist metadata we may safely strip. APNG, palettes, color profiles and unknown
      // semantics need an explicit RGBA export, rather than silently changing appearance.
      if (!['tEXt', 'zTXt', 'iTXt', 'pHYs', 'tIME'].includes(name)) fail(`unsupported_chunk_${name}`);
    }
    offset = end;
  }
  if (!ended) fail('missing_end');
  const stride = width * 4, expected = height * (stride + 1), packed = Buffer.concat(compressed);
  let raw: Buffer;
  try {
    const result = inflateSync(packed, {maxOutputLength: expected, info: true}) as unknown as {buffer: Buffer; engine: {bytesWritten: number}};
    if (result.engine.bytesWritten !== packed.length) fail('compressed_trailing_bytes'); raw = result.buffer;
  } catch (error) {if (error instanceof Error && error.message.startsWith('invalid_storybook_png:')) throw error; return fail('inflate');}
  if (raw.length !== expected) fail('scanline_length');
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; if (filter > 4) fail('filter');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x, a = x < 4 ? 0 : pixels[at - 4], b = y ? pixels[at - stride] : 0;
      const c = y && x >= 4 ? pixels[at - stride - 4] : 0;
      const predict = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      pixels[at] = (raw[y * (stride + 1) + x + 1] + predict) & 255;
    }
  }
  return {width, height, pixels};
}
