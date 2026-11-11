/** SYNTHETIC test/export fixture: 80 numbered arrow cells and four registered layer marks.
 * No people, appearance identities, reference images, furniture or production artwork.
 */
import {encodeRgbaPng, sha256} from './storybook-png.js';
import type {StorybookBuildRecipe} from './storybook-asset-pipeline.js';

export function createSyntheticStorybookInput() {
  const width = 128, height = 220, w = 16, h = 20, pixels = new Uint8Array(width * height * 4);
  const assets: StorybookBuildRecipe['assets'] = [], characters: StorybookBuildRecipe['characters'] = [];
  let index = 0;
  function frame(direction: number) {
    const n = index++, x = n % 8 * w, y = Math.floor(n / 8) * h;
    const put = (dx: number, dy: number, alpha = 255) => pixels.set([40 + n * 2, 60 + direction * 30, 110, alpha], ((y + dy) * width + x + dx) * 4);
    // S stamp, explicit direction arm, cell number bits, stable foot-edge. Deliberately not anatomy.
    const stamp = '111100111001111'; for (let p = 0; p < 15; p++) if (stamp[p] === '1') put(1 + p % 3, 1 + Math.floor(p / 3));
    for (let dy = 8; dy < h; dy++) put(8, dy);
    for (let d = 0; d < 5; d++) put(8 + (direction < 2 ? d : -d), 10 + (direction === 0 || direction === 3 ? -d : d));
    for (let bit = 0; bit < 7; bit++) if (n & (1 << bit)) put(5 + bit, 2, 160);
    return {sourceId: 'synthetic-arrows', rect: {x, y, width: w, height: h}, foot: {x: 8, y: 20}, transparency: 'required' as const};
  }
  for (let person = 0; person < 2; person++) {
    const clips: StorybookBuildRecipe['characters'][number]['clips'] = {idle: {cels: []}, walk: {cels: []}, pick: person ? null : {cels: []}};
    for (const name of ['idle', 'walk', 'pick'] as const) {
      if (clips[name] === null) continue;
      for (let cel = 0; cel < ({idle: 2, walk: 6, pick: 4})[name]; cel++) {
        const id = `diagnostic-${person}-${name}-${cel}`;
        assets.push({id, kind: 'directional', footprint: {width: 1, height: 1}, groundAnchor: {x: .5, y: .5},
          frames: {north: frame(0), east: frame(1), south: frame(2), west: frame(3)}});
        clips[name]!.cels.push({assetId: id, durationMs: name === 'idle' ? 5000 : name === 'walk' ? 100 : 200});
      }
    }
    characters.push({id: `synthetic-arrow-${person}`, clips});
  }
  for (const [n, layer] of ['contact', 'body', 'roof', 'front'].entries()) assets.push({id: `synthetic-${layer}`, kind: 'static',
    footprint: {width: 8, height: 6}, groundAnchor: {x: 4, y: 6}, frame: frame(n)});
  const png = encodeRgbaPng({width, height, pixels});
  const recipe: StorybookBuildRecipe = {
    buildSchemaVersion: 1, packId: 'synthetic-pipeline-diagnostic', packVersion: '0.1.0', purpose: 'synthetic-diagnostic', profile: 'first-batch',
    atlas: {width: 256, maxHeight: 2048, padding: 2},
    provenance: {source: 'SYNTHETIC repository-generated numbered arrows and layer registration marks; not production artwork', author: 'ai-valley contributors', license: 'MIT (repository)'},
    sources: [{id: 'synthetic-arrows', path: 'synthetic-input.png', sha256: sha256(png), width, height, role: 'synthetic-diagnostic',
      authorization: {purpose: 'atlas-assembly', reference: 'Repository-created synthetic fixture only; no uploaded image or resident identity', author: 'ai-valley contributors', license: 'MIT (repository)'}}],
    assets, characters,
    buildings: [{id: 'synthetic-layer-registration', layers: {contact: 'synthetic-contact', body: 'synthetic-body', roof: 'synthetic-roof', foreground: ['synthetic-front']}, points: {door: {x: 8, y: 19}, operations: []}}],
  };
  const recipeBytes = Buffer.from(JSON.stringify(recipe, null, 2) + '\n');
  return {recipe, recipeBytes, recipeSha256: sha256(recipeBytes), png, sources: new Map([['synthetic-arrows', png]])};
}
