/** Code-native calibration geometry, NOT final artwork or a simulation snapshot.
 * The house uses the recorded lodge footprint. Figures are anonymous measuring
 * mannequins, not resident appearances, and have only one static pose. */
import {projectStorybook} from './storybook-geometry.js';
import type {StorybookPoint} from './storybook-assets.js';

export const SLICE = Object.freeze({
  density: 2, width: 8, height: 6, door: Object.freeze({x: 4, y: 6}),
  doorHeight: 70, wallHeight: 86, ridgeHeight: 118,
  adultHeight: 56, adultHeads: 4.5, teenHeight: 47.6, teenHeads: 4.2,
  buildingFrame: Object.freeze({width: 288, height: 256, origin: Object.freeze({x: 112, y: 112})}),
  figureFrame: Object.freeze({width: 48, height: 80, foot: Object.freeze({x: 24, y: 72})}),
});
export type SliceColor = readonly [number, number, number, number];
export type SliceShape =
  {kind: 'polygon'; points: readonly StorybookPoint[]; color: SliceColor} |
  {kind: 'ellipse'; center: StorybookPoint; radius: StorybookPoint; color: SliceColor};
export interface SliceAsset {id: string; width: number; height: number; shapes: SliceShape[];}
const color = (hex: string, alpha = 255): SliceColor => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), alpha];
const palette = {stone: color('B6AEA0'), stoneShade: color('8F9286'), wall: color('E5D7BB'), wallShade: color('C6BEA7'), wood: color('80624C'), dark: color('3E382F'), roof: color('777477'), roofShade: color('55596B'), skin: color('DAB68E')};
export function slicePoint(x: number, y: number, z = 0): StorybookPoint {
  const p = projectStorybook({x, y}, z);
  return {x: p.x + SLICE.buildingFrame.origin.x, y: p.y + SLICE.buildingFrame.origin.y};
}
export const sliceGroundCorners = () => [[0, 0], [8, 0], [8, 6], [0, 6]].map(([x, y]) => slicePoint(x, y));
function poly(points: readonly StorybookPoint[], color: SliceColor): SliceShape {return {kind: 'polygon', points, color};}
function face(vertices: readonly (readonly [number, number, number])[], color: SliceColor): SliceShape {return poly(vertices.map(([x, y, z]) => slicePoint(x, y, z)), color);}
function figure(id: string, height: number, heads: number, shirt: SliceColor): SliceAsset {
  const {width, height: frameHeight, foot} = SLICE.figureFrame;
  const head = height / heads, top = foot.y - height, cx = foot.x;
  const pt = (x: number, y: number) => ({x: cx + x * head, y: top + y * head});
  const part = (points: number[][], c: SliceColor) => poly(points.map(([x, y]) => pt(x, y)), c);
  const shapes: SliceShape[] = [
    {kind: 'ellipse', center: {x: cx, y: foot.y}, radius: {x: head * .7, y: head * .18}, color: color('55596B', 50)},
    // Anatomy ruler includes hair inside the head envelope; feet end at the registered anchor.
    part([[-.48, 2.65], [-.02, 2.65], [-.07, heads - .15], [-.42, heads - .15]], palette.dark),
    part([[.04, 2.65], [.5, 2.65], [.42, heads - .15], [.1, heads - .15]], color('67604D')),
    part([[-.45, heads - .2], [-.06, heads - .2], [-.03, heads], [-.6, heads]], palette.dark),
    part([[.1, heads - .2], [.42, heads - .2], [.62, heads], [.08, heads]], palette.dark),
    part([[-.6, 1.32], [-.85, 2.35], [-.58, 2.43], [-.36, 1.75]], shirt),
    part([[.58, 1.3], [.82, 2.3], [.54, 2.4], [.34, 1.7]], shirt),
    part([[-.8, 2.3], [-.57, 2.34], [-.58, 2.65], [-.77, 2.65]], palette.skin),
    part([[.55, 2.31], [.8, 2.28], [.77, 2.6], [.58, 2.62]], palette.skin),
    part([[-.57, 1.23], [0, 1.08], [.57, 1.23], [.52, 2.86], [-.53, 2.86]], shirt),
    part([[-.22, 1.06], [.17, 1.06], [.22, 1.31], [0, 1.53], [-.24, 1.28]], palette.skin),
    part([[-.28, 1.19], [.03, 1.45], [.27, 1.2], [.1, 1.68], [-.08, 2.7], [-.22, 2.7], [-.07, 1.57], [-.36, 1.31]], color('F4ECD9')),
    part([[-.54, 2.32], [.54, 2.32], [.54, 2.48], [-.54, 2.48]], palette.wood),
    {kind: 'ellipse', center: pt(0, .5), radius: {x: .41 * head, y: .5 * head}, color: palette.skin},
    part([[-.4, .56], [-.43, .18], [-.2, 0], [.22, 0], [.43, .2], [.39, .4], [.18, .24], [-.18, .3], [-.28, .61]], palette.dark),
  ];
  return {id, width, height: frameHeight, shapes};
}
export function sliceAssets(): SliceAsset[] {
  const building = (id: string, shapes: SliceShape[]): SliceAsset => ({id, width: SLICE.buildingFrame.width, height: SLICE.buildingFrame.height, shapes});
  const {wallHeight: h, ridgeHeight: r} = SLICE;
  const contact: SliceShape[] = [face([[0, 0, 0], [8, 0, 0], [8, 6, 0], [0, 6, 0]], color('55596B', 75))];
  const body: SliceShape[] = [
    face([[8, 0, 0], [8, 6, 0], [8, 6, h], [8, 0, h]], palette.wallShade),
    face([[0, 6, 0], [8, 6, 0], [8, 6, h], [0, 6, h]], palette.wall),
    face([[8, 0, h], [8, 3, r], [8, 6, h]], palette.wallShade),
    face([[8, 0, 0], [8, 6, 0], [8, 6, 8], [8, 0, 8]], palette.stoneShade),
    face([[0, 6, 0], [8, 6, 0], [8, 6, 8], [0, 6, 8]], palette.stone),
    // Opening is a calibration aperture, not a claim about current door state.
    face([[3.15, 6, 0], [4.85, 6, 0], [4.85, 6, 73], [3.15, 6, 73]], palette.wood),
    face([[3.3, 6, 0], [4.7, 6, 0], [4.7, 6, 70], [3.3, 6, 70]], palette.dark),
  ];
  for (const x of [0, 2.7, 5.3, 7.85]) body.push(face([[x, 6, 8], [x + .15, 6, 8], [x + .15, 6, h], [x, 6, h]], palette.wood));
  for (const [x0, x1, z] of [[0, 3.15, 13], [4.85, 8, 13], [0, 8, 78]]) body.push(face([[x0, 6, z], [x1, 6, z], [x1, 6, z + 3], [x0, 6, z + 3]], palette.wood));
  for (const x of [1, 6]) {
    body.push(face([[x, 6, 36], [x + 1, 6, 36], [x + 1, 6, 61], [x, 6, 61]], palette.wood));
    body.push(face([[x + .12, 6, 39], [x + .88, 6, 39], [x + .88, 6, 58], [x + .12, 6, 58]], color('A0AB9D')));
    for (const d of [.33, .65]) body.push(face([[x + d, 6, 39], [x + d + .06, 6, 39], [x + d + .06, 6, 58], [x + d, 6, 58]], palette.wood));
  }
  const roof: SliceShape[] = [
    face([[-.35, -.35, h - 3], [8.35, -.35, h - 3], [8.35, 3, r], [-.35, 3, r]], palette.roofShade),
    face([[-.35, 3, r], [8.35, 3, r], [8.35, 6.35, h - 3], [-.35, 6.35, h - 3]], palette.roof),
    face([[-.4, 6.35, h - 3], [8.4, 6.35, h - 3], [8.4, 6.35, h - 7], [-.4, 6.35, h - 7]], palette.wood),
    face([[-.4, 2.88, r + 1], [8.4, 2.88, r + 1], [8.4, 3.12, r + 1], [-.4, 3.12, r + 1]], color('99918A')),
  ];
  for (const y of [3.7, 4.4, 5.1, 5.8]) {
    const z = r - (y - 3) * (r - h + 3) / 3.35;
    roof.push(face([[-.35, y, z], [8.35, y, z], [8.35, y + .04, z - .42], [-.35, y + .04, z - .42]], color('67636B')));
  }
  return [building('slice-contact', contact), building('slice-body', body), building('slice-roof', roof),
    figure('slice-adult', SLICE.adultHeight, SLICE.adultHeads, color('6F7F89')),
    figure('slice-teen', SLICE.teenHeight, SLICE.teenHeads, color('A4664F'))];
}
export const SLICE_STATIONS = Object.freeze([
  {label: '院落标尺', adult: {x: 4, y: 8}, teen: {x: 6, y: 8}, view: 'front'},
  {label: '门槛对齐', adult: {x: 4, y: 6}, teen: {x: 6, y: 8}, view: 'front'},
  {label: '屋后遮挡', adult: {x: 4, y: -.75}, teen: {x: 6, y: 8}, view: 'behind'},
] as const);
