/** Offline rasterization of code-native geometry. This is NOT generated storybook art. */
import {SLICE, sliceAssets, slicePoint, type SliceShape} from '../client/storybook-slice-model.js';
import {parseStorybookManifest} from '../client/storybook-assets.js';
import {encodeRgbaPng, sha256} from './storybook-png.js';
export const slicePin = {packId: 'calibration-geometry', packVersion: '0.1.0'};
function inside(shape: SliceShape, x: number, y: number): boolean {
  if (shape.kind === 'ellipse') return ((x - shape.center.x) / shape.radius.x) ** 2 + ((y - shape.center.y) / shape.radius.y) ** 2 < 1;
  let hit = false;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const a = shape.points[i], b = shape.points[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
export function buildSliceAssets() {
  const density = SLICE.density, width = 1728, height = 672;
  const pixels = new Uint8Array(width * height * 4);
  const assets = sliceAssets().map((asset, index) => {
    const ox = index < 3 ? index * 576 : (index - 3) * 96, oy = index < 3 ? 0 : 512;
    for (const shape of asset.shapes) {
      const points = shape.kind === 'polygon' ? shape.points : [
        {x: shape.center.x - shape.radius.x, y: shape.center.y - shape.radius.y},
        {x: shape.center.x + shape.radius.x, y: shape.center.y + shape.radius.y}];
      const x0 = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) * density));
      const y0 = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) * density));
      const x1 = Math.min(asset.width * density, Math.ceil(Math.max(...points.map(p => p.x)) * density));
      const y1 = Math.min(asset.height * density, Math.ceil(Math.max(...points.map(p => p.y)) * density));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        let coverage = 0;
        for (const sy of [.25, .75]) for (const sx of [.25, .75]) if (inside(shape, (x + sx) / density, (y + sy) / density)) coverage++;
        if (!coverage) continue;
        const at = ((oy + y) * width + ox + x) * 4, alpha = shape.color[3] / 255 * coverage / 4;
        const old = pixels[at + 3] / 255, next = alpha + old * (1 - alpha);
        for (let c = 0; c < 3; c++) pixels[at + c] = Math.round((shape.color[c] * alpha + pixels[at + c] * old * (1 - alpha)) / next);
        pixels[at + 3] = Math.round(next * 255);
      }
    }
    const foot = index < 3 ? slicePoint(SLICE.door.x, SLICE.door.y) : SLICE.figureFrame.foot;
    return {id: asset.id, kind: 'static', footprint: index < 3 ? {width: 8, height: 6} : {width: 1, height: 1},
      groundAnchor: index < 3 ? {...SLICE.door} : {x: .5, y: .5},
      frame: {rect: {x: ox, y: oy, width: asset.width * density, height: asset.height * density}, foot: {x: foot.x * density, y: foot.y * density}}};
  });
  const png = encodeRgbaPng({width, height, pixels});
  const manifest = parseStorybookManifest({schemaVersion: 2, ...slicePin,
    projection: {tileWidth: 32, tileHeight: 16},
    atlas: {path: 'assets/storybook/geometry-slice.png', width, height, sha256: sha256(png), pixelsPerUnit: density},
    provenance: {source: 'Repository-created calibration geometry; NOT final art, resident identity, animation or world evidence', author: 'ai-valley contributors', license: 'MIT (repository)'}, assets,
  }, slicePin);
  return {png, manifest};
}
