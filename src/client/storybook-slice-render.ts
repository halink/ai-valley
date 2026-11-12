/** Explicit measuring stations, never world state, traversal or action playback. */
import {SLICE, SLICE_STATIONS} from './storybook-slice-model.js';
import {placeStorybookAsset, projectStorybook} from './storybook-geometry.js';
import {storybookPixelsPerUnit, type StorybookManifest} from './storybook-assets.js';
export const SLICE_VIEW = Object.freeze({width: 640, height: 380, origin: Object.freeze({x: 336, y: 182})});
export interface SliceViewOptions {station: number; roof: boolean; guides: boolean; reveal: boolean;}
export function sliceDrawCommands(manifest: StorybookManifest, options: SliceViewOptions) {
  const station = SLICE_STATIONS[options.station];
  if (!station) throw new Error('slice_station');
  const density = storybookPixelsPerUnit(manifest);
  const command = (id: string, at: {x: number; y: number}, building = false, alpha = 1) => {
    const asset = manifest.assets.find(a => a.id === id);
    if (!asset) throw new Error('slice_asset_missing');
    const footprint = building ? {x: 0, y: 0, width: 8, height: 6} : {x: at.x - .5, y: at.y - .5, width: 1, height: 1};
    return {id, alpha, ...placeStorybookAsset(footprint, asset, null, density)};
  };
  const adult = command('slice-adult', station.adult), teen = command('slice-teen', station.teen);
  const faded = options.reveal && station.view === 'behind' ? .25 : 1;
  return [command('slice-contact', SLICE.door, true), ...(station.view === 'behind' ? [adult] : []),
    command('slice-body', SLICE.door, true, faded), ...(options.roof ? [command('slice-roof', SLICE.door, true, faded)] : []),
    ...(station.view !== 'behind' ? [adult] : []), teen];
}
export function drawSlice(context: CanvasRenderingContext2D, atlas: CanvasImageSource, manifest: StorybookManifest, options: SliceViewOptions): void {
  const {width, height, origin} = SLICE_VIEW;
  context.save();
  try {
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#ebe8d7'; context.fillRect(0, 0, width, height);
    context.translate(origin.x, origin.y);
    const line = (a: {x: number; y: number}, b: {x: number; y: number}, stroke: string, width = 1) => {
      context.strokeStyle = stroke; context.lineWidth = width;
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    };
    // Quiet measuring ground. No invented roads, resources or walkable world cells.
    if (options.guides) for (let i = -3; i <= 12; i++) {
      line(projectStorybook({x: i, y: -3}), projectStorybook({x: i, y: 12}), '#d4d7bd', .65);
      line(projectStorybook({x: -3, y: i}), projectStorybook({x: 12, y: i}), '#d4d7bd', .65);
    }
    context.imageSmoothingEnabled = true;
    for (const command of sliceDrawCommands(manifest, options)) {
      const {rect} = command.frame;
      context.globalAlpha = command.alpha;
      context.drawImage(atlas, rect.x, rect.y, rect.width, rect.height, command.topLeft.x, command.topLeft.y, command.size.width, command.size.height);
    }
    context.globalAlpha = 1;
    if (options.guides) {
      const corners = [[0, 0], [8, 0], [8, 6], [0, 6]].map(([x, y]) => projectStorybook({x, y}));
      for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], '#467b77', 1.2);
      const station = SLICE_STATIONS[options.station];
      for (const at of [SLICE.door, station.adult, station.teen]) {
        const p = projectStorybook(at);
        line({x: p.x - 4, y: p.y}, {x: p.x + 4, y: p.y}, '#a6493e');
        line({x: p.x, y: p.y - 4}, {x: p.x, y: p.y + 4}, '#a6493e');
      }
      // Rulers are overlays, not furniture or resident height inference.
      const door = projectStorybook(SLICE.door), a = {x: door.x - 22, y: door.y};
      line(a, {x: a.x, y: a.y - SLICE.doorHeight}, '#a6493e');
      for (const y of [a.y, a.y - SLICE.doorHeight]) line({x: a.x - 3, y}, {x: a.x + 3, y}, '#a6493e');
      for (const [at, figureHeight, heads] of [[station.adult, SLICE.adultHeight, SLICE.adultHeads], [station.teen, SLICE.teenHeight, SLICE.teenHeads]] as const) {
        const p = projectStorybook(at), x = p.x + 17, top = p.y - figureHeight;
        line({x, y: top}, {x, y: p.y}, '#55596b');
        for (let i = 0; i <= heads; i++) line({x: x - 2, y: top + figureHeight / heads * i}, {x: x + 2, y: top + figureHeight / heads * i}, '#55596b');
        line({x: x - 3, y: p.y}, {x: x + 3, y: p.y}, '#55596b');
      }
    }
  } finally {context.restore();}
}
