import {parseStorybookManifest, type StorybookManifest, type StorybookPackPin} from './storybook-assets.js';

export const STORYBOOK_ATLAS_MAX_SIDE = 2048;
export const STORYBOOK_ATLAS_MAX_BYTES = 20 * 1024 * 1024;
export type StorybookDecodedAtlas = Readonly<{width: number; height: number; pixels: Uint8ClampedArray}>;
export type StorybookAtlasDecoder = (bytes: Uint8Array) => Promise<StorybookDecodedAtlas>;
/** Metadata is detached and frozen. Pixels are an owned copy, not the decoder's buffer. */
export type StorybookTexture = StorybookDecodedAtlas & Readonly<{
  manifest: StorybookManifest;
  frameKeys: readonly string[];
}>;
function fail(reason: string): never { throw new Error(`invalid_storybook_texture: ${reason}`); }
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decode only supplied bytes, never a path/URL. Bitmap lifetime ends even on readback failure. */
export const decodeStorybookPng: StorybookAtlasDecoder = async bytes => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return fail('browser_decoder_unavailable');
  const copy = new Uint8Array(bytes);
  const bitmap = await createImageBitmap(new Blob([copy.buffer], {type: 'image/png'}));
  try {
    if (bitmap.width < 1 || bitmap.height < 1 || bitmap.width > STORYBOOK_ATLAS_MAX_SIDE || bitmap.height > STORYBOOK_ATLAS_MAX_SIDE) return fail('decoded_bounds');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (!context) return fail('canvas_unavailable');
    context.drawImage(bitmap, 0, 0);
    return {width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data};
  } finally { bitmap.close(); }
};

/** Hash and bounded PNG-header checks precede decode. Injected decoders are trusted test adapters,
 * not evidence that a browser decoded these bytes. Provenance remains an author declaration. */
export async function prepareStorybookAtlas(input: unknown, pin: StorybookPackPin, bytes: Uint8Array, decode: StorybookAtlasDecoder = decodeStorybookPng): Promise<StorybookTexture> {
  const manifest = parseStorybookManifest(input, pin);
  if (manifest.atlas.width > STORYBOOK_ATLAS_MAX_SIDE || manifest.atlas.height > STORYBOOK_ATLAS_MAX_SIDE) return fail('declared_bounds');
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > STORYBOOK_ATLAS_MAX_BYTES) return fail('byte_bounds');
  const owned = new Uint8Array(bytes);
  if (signature.some((v, i) => owned[i] !== v)) return fail('png_signature');
  const header = new DataView(owned.buffer);
  if (header.getUint32(8) !== 13 || String.fromCharCode(...owned.subarray(12, 16)) !== 'IHDR') return fail('png_ihdr');
  if (header.getUint32(16) !== manifest.atlas.width || header.getUint32(20) !== manifest.atlas.height) return fail('png_dimensions');
  // This first atlas contract requires explicit 8-bit RGBA, conventional compression/filtering.
  if (owned[24] !== 8 || owned[25] !== 6 || owned[26] !== 0 || owned[27] !== 0 || owned[28] > 1) return fail('png_format');
  if (!globalThis.crypto?.subtle) return fail('sha256_unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned.buffer);
  const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.atlas.sha256) return fail('sha256_mismatch');
  const decoded = await decode(owned);
  if (decoded.width !== manifest.atlas.width || decoded.height !== manifest.atlas.height) return fail('decoded_dimensions');
  if (!(decoded.pixels instanceof Uint8ClampedArray) || decoded.pixels.length !== decoded.width * decoded.height * 4) return fail('decoded_pixels');
  const frameKeys = Object.freeze(manifest.assets.flatMap(asset => asset.kind === 'static' ? [asset.id] : Object.keys(asset.frames).map(direction => `${asset.id}:${direction}`)));
  return Object.freeze({manifest, width: decoded.width, height: decoded.height, pixels: new Uint8ClampedArray(decoded.pixels), frameKeys});
}
