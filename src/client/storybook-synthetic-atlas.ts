/** Diagnostic SYNTHETIC shapes only. Repository-created, MIT. No reference artwork,
 * resident appearance, furniture, resources, lights or production animation is represented. */
import {parseStorybookManifest, type StorybookAsset, type StorybookDirection} from './storybook-assets.js';
export const syntheticPin = Object.freeze({packId: 'diagnostic-synthetic', packVersion: '0.1.0'});
export const SYNTHETIC_WIDTH = 256;
export const SYNTHETIC_HEIGHT = 544;
const directions: StorybookDirection[] = ['northeast', 'southeast', 'southwest', 'northwest'];
const terrain = ['grass', 'path', 'water', 'sand', 'cliff', 'soil', 'bridge', 'road'];
function frame(x: number, y: number, width: number, height: number, footX: number, footY: number) {
  return {rect: {x, y, width, height}, foot: {x: footX, y: footY}};
}
const single = {footprint: {width: 1, height: 1}, groundAnchor: {x: 0.5, y: 0.5}};
const assets: StorybookAsset[] = [
  ...terrain.map((name, index): StorybookAsset => ({id: `terrain-${name}`, kind: 'static', ...single, frame: frame(index * 32, 0, 32, 16, 16, 8)})),
  {id: 'marker', kind: 'static', ...single, frame: frame(0, 16, 32, 48, 16, 48)},
  {id: 'resident-route', kind: 'directional', ...single, frames: Object.fromEntries(directions.map((direction, index) => [direction, frame(32 + index * 32, 16, 32, 48, 16, 48)])) as Record<StorybookDirection, ReturnType<typeof frame>>},
  ...['contact', 'body', 'roof'].map((name, index): StorybookAsset => ({id: `lodge-${name}`, kind: 'static', footprint: {width: 8, height: 6}, groundAnchor: {x: 4, y: 6}, frame: frame(0, 64 + 160 * index, 224, 160, 64, 128)})),
];
const PNG_SHA256 = 'd37a07767481141c7160c713bd6d1e3ea926e3facdc54212b90641fb423d167d';
const PNG_BASE64 = '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';
export const syntheticManifest = parseStorybookManifest({schemaVersion: 1, ...syntheticPin,
  projection: {tileWidth: 32, tileHeight: 16},
  atlas: {path: 'assets/storybook/synthetic-prototype.png', width: SYNTHETIC_WIDTH, height: SYNTHETIC_HEIGHT, sha256: PNG_SHA256},
  provenance: {source: 'Repository-created diagnostic SYNTHETIC atlas; not final art or uploaded reference images', author: 'ai-valley contributors', license: 'MIT (repository)'}, assets,
}, syntheticPin);
export function syntheticAtlasBytes(): Uint8Array { return Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0)); }

/** Procedural source for the committed PNG and explicitly injected offline tests. */
export function syntheticAtlasPixels(): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SYNTHETIC_WIDTH * SYNTHETIC_HEIGHT * 4);
  const ink = [62, 56, 47, 255];
  function put(x: number, y: number, color: number[]) {
    if (x >= 0 && y >= 0 && x < SYNTHETIC_WIDTH && y < SYNTHETIC_HEIGHT) pixels.set(color, (y * SYNTHETIC_WIDTH + x) * 4);
  }
  function line(x0: number, y0: number, x1: number, y1: number, color = ink) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) put(Math.round(x0 + (x1 - x0) * i / (steps || 1)), Math.round(y0 + (y1 - y0) * i / (steps || 1)), color);
  }
  const letters: Record<string, string> = {S: '111100111001111', Y: '101101010010010', N: '101111111111101', T: '111010010010010', H: '101101111101101', E: '111100110100111', I: '111010010010111', C: '111100100100111', '?': '111001011000010'};
  function label(text: string, x: number, y: number) {
    for (const [index, char] of [...text].entries()) for (let p = 0; p < 15; p++) if (letters[char]?.[p] === '1') put(x + index * 4 + p % 3, y + Math.floor(p / 3), ink);
  }
  const colors = [[176,184,139], [194,169,131], [113,153,154], [223,209,165], [182,174,160], [130,100,74], [160,128,93], [148,140,125]];
  for (let n = 0; n < 8; n++) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (Math.abs((x + 0.5 - 16) / 16) + Math.abs((y + 0.5 - 8) / 8) <= 1) put(n * 32 + x, y, [...colors[n], 255]);
    label('S', n * 32 + 15, 5);
  }
  // Neutral question marker, never a body pose or activity claim; lowest pixel meets its foot edge.
  for (let x = 11; x <= 20; x++) line(x, 34, x, 45, [244,236,217,255]);
  label('?', 14, 37); line(14, 46, 17, 46); line(15, 47, 16, 47); line(15, 48, 16, 48); line(16, 49, 16, 63);
  for (let n = 0; n < 4; n++) {
    const ox = 32 + n * 32, sx = n < 2 ? 1 : -1, sy = n === 0 || n === 3 ? -1 : 1;
    line(ox + 16, 63, ox + 16, 49, [128,98,76,255]);
    const tx = ox + 16 + sx * 10, ty = 37 + sy * 7;
    line(ox + 16 - sx * 6, 37 - sy * 4, tx, ty);
    line(tx, ty, tx - sx * 6, ty); line(tx, ty, tx, ty - sy * 6);
    label('S', ox + 3, 19);
  }
  // 8×6 projected footprint: corners (96,48),(224,112),(128,160),(0,96).
  // Anchor (4,6) is (64,128). Body and roof are diagnostic outlines, not invented room contents.
  for (let layer = 0; layer < 3; layer++) {
    const oy = 64 + 160 * layer, rise = layer === 0 ? 0 : layer === 1 ? 32 : 48;
    const vertices = [[96,48-rise],[223,112-rise],[128,159-rise],[0,96-rise]];
    const color = layer === 0 ? [85,89,107,180] : layer === 1 ? [128,98,76,255] : [119,116,119,255];
    for (let i = 0; i < 4; i++) {
      const a = vertices[i], b = vertices[(i+1)%4];
      line(a[0], oy+a[1], b[0], oy+b[1], color);
      if (layer === 1) line(a[0], oy+a[1], a[0], oy+a[1]+31, color);
    }
    label('SYNTHETIC', 90, oy + (layer === 0 ? 94 : 62));
  }
  label('SYNTHETIC', 164, 23);
  return pixels;
}
