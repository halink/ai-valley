/** Metadata only. No image bytes, art or production resident identity claim. */
export const animationPin = {packId: 'synthetic-animation', packVersion: '1.0.0'};
export function animationFixture(ids = ['resident-walk']) {
  const names = ['idle', 'walk', 'pick'] as const, counts = {idle: 2, walk: 6, pick: 4};
  const assets: any[] = []; let cell = 0;
  const clips = Object.fromEntries(names.map(name => [name, {cels: Array.from({length: counts[name]}, (_, i) => {
    const id = `${name}-${i}`;
    assets.push({id, kind: 'directional', footprint: {width: 1, height: 1}, groundAnchor: {x: .5, y: .5}, frames: Object.fromEntries(['northeast', 'southeast', 'southwest', 'northwest'].map(direction => {
      const index = cell++;
      return [direction, {rect: {x: index % 16 * 32, y: Math.floor(index / 16) * 64, width: 32, height: 64}, foot: {x: 16, y: 60}}];
    }))});
    return {assetId: id, durationMs: name === 'idle' ? (i === 0 ? 5000 : 1000) : name === 'walk' ? 100 : 200};
  })}])) as any;
  return {
    atlas: {schemaVersion: 1, ...animationPin, projection: {tileWidth: 32, tileHeight: 16}, atlas: {path: 'assets/storybook/synthetic-animation.png', width: 512, height: 192, sha256: 'a'.repeat(64)}, provenance: {source: 'Synthetic CPU metadata only; no image supplied', author: 'Test fixture', license: 'Test metadata only'}, assets},
    animation: {animationSchemaVersion: 1, atlas: {...animationPin, sha256: 'a'.repeat(64)}, characters: [{id: 'synthetic-person', clips}], bindings: ids.map(residentId => ({residentId, characterId: 'synthetic-person'}))},
  };
}
export function freezeAnimationFixture(value: unknown): void {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {Object.freeze(value); Object.values(value).forEach(freezeAnimationFixture);}
}
