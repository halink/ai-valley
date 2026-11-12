/** Test-only pixel replication for density invariants, not an artwork production method. */
import {parseStorybookManifest} from '../../src/client/storybook-assets.js';
import type {StorybookPixelAtlas} from '../../src/client/storybook-render-plan.js';
export function densityAtlas(input: StorybookPixelAtlas, density: number): StorybookPixelAtlas {
  const width = input.width * density, height = input.height * density, pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (Math.floor(y / density) * input.width + Math.floor(x / density)) * 4;
    pixels.set(input.pixels.subarray(from, from + 4), (y * width + x) * 4);
  }
  const source = structuredClone(input.manifest);
  for (const a of source.assets) for (const f of a.kind === 'static' ? [a.frame] : Object.values(a.frames)) {
    for (const key of ['x', 'y', 'width', 'height'] as const) (f.rect as any)[key] *= density;
    (f.foot as any).x *= density; (f.foot as any).y *= density;
  }
  // No PNG is claimed here. A decoder test must encode bytes and replace this sentinel digest.
  const manifest = parseStorybookManifest({...source, schemaVersion: 2,
    atlas: {...source.atlas, width, height, pixelsPerUnit: density, sha256: '0'.repeat(64)}},
  {packId: source.packId, packVersion: source.packVersion});
  return {manifest, width, height, pixels};
}
