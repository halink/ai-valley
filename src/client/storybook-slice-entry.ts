/** Standalone DEV-only calibration page. No import of the game, ObserverMap or server. */
import manifestData from './assets/storybook/geometry-slice.manifest.json';
import atlasUrl from './assets/storybook/geometry-slice.png?url';
import {prepareStorybookAtlas} from './storybook-texture.js';
import {SLICE_STATIONS} from './storybook-slice-model.js';
import {drawSlice, SLICE_VIEW, type SliceViewOptions} from './storybook-slice-render.js';
import './storybook-slice.css';

export async function mountSlice(root: HTMLElement): Promise<() => void> {
  const status = root.querySelector<HTMLElement>('[data-slice-status]')!;
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const controls = root.querySelector<HTMLFieldSetElement>('fieldset')!;
  const viewport = root.querySelector<HTMLElement>('[data-slice-viewport]')!;
  const abort = new AbortController();
  let disposed = false, image: HTMLCanvasElement | null = null;
  const releases: Array<() => void> = [];
  const dispose = () => {
    if (disposed) return; disposed = true; abort.abort();
    while (releases.length) releases.pop()!();
    if (image) {image.width = 1; image.height = 1; image = null;}
    canvas.width = 1; canvas.height = 1; controls.disabled = true;
  };
  const fail = () => {
    if (!disposed) {status.textContent = '校准图集未能验证或绘制。未启用预览，请返回原观察界面。'; status.setAttribute('role', 'alert');}
    dispose();
  };
  // Register cancellation before awaiting a fetch. HMR or navigation can interrupt loading.
  const pagehide = (event: PageTransitionEvent) => {if (!event.persisted) dispose();};
  window.addEventListener('pagehide', pagehide); releases.push(() => window.removeEventListener('pagehide', pagehide));
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  try {
    const response = await fetch(atlasUrl, {signal: abort.signal, credentials: 'omit'});
    if (!response.ok) throw new Error('slice_atlas_unavailable');
    const texture = await prepareStorybookAtlas(manifestData, {packId: 'calibration-geometry', packVersion: '0.1.0'}, new Uint8Array(await response.arrayBuffer()));
    if (disposed) return dispose;
    image = document.createElement('canvas'); image.width = texture.width; image.height = texture.height;
    const sourceContext = image.getContext('2d'); if (!sourceContext) throw new Error('slice_canvas_unavailable');
    const data = sourceContext.createImageData(texture.width, texture.height); data.data.set(texture.pixels); sourceContext.putImageData(data, 0, 0);
    const context = canvas.getContext('2d'); if (!context) throw new Error('slice_canvas_unavailable');
    const options = (): SliceViewOptions => ({
      station: Number(root.querySelector<HTMLSelectElement>('[name=station]')!.value),
      roof: root.querySelector<HTMLInputElement>('[name=roof]')!.checked,
      guides: root.querySelector<HTMLInputElement>('[name=guides]')!.checked,
      reveal: root.querySelector<HTMLInputElement>('[name=reveal]')!.checked,
    });
    const redraw = () => {
      if (disposed || !image) return;
      const zoom = Number(root.querySelector<HTMLSelectElement>('[name=zoom]')!.value), dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.width = Math.ceil(SLICE_VIEW.width * zoom * dpr); canvas.height = Math.ceil(SLICE_VIEW.height * zoom * dpr);
      canvas.style.width = `${SLICE_VIEW.width * zoom}px`; canvas.style.height = `${SLICE_VIEW.height * zoom}px`;
      context.setTransform(zoom * dpr, 0, 0, zoom * dpr, 0, 0);
      const selected = options(); drawSlice(context, image, texture.manifest, selected);
      status.textContent = `几何校准 · ${SLICE_STATIONS[selected.station].label} · 成人 ${56 * zoom} CSS px · 少年 ${(47.6 * zoom).toFixed(1)} CSS px。静态样例，无世界连接、居民身份或动作结算。`;
    };
    const center = () => {viewport.scrollLeft = Math.max(0, (canvas.clientWidth - viewport.clientWidth) / 2);};
    const change = () => {try {redraw(); center();} catch {fail();}};
    controls.addEventListener('change', change); releases.push(() => controls.removeEventListener('change', change));
    window.addEventListener('resize', change); releases.push(() => window.removeEventListener('resize', change));
    canvas.addEventListener('contextlost', fail); releases.push(() => canvas.removeEventListener('contextlost', fail));
    controls.disabled = false; redraw(); center();
    return dispose;
  } catch {fail(); return dispose;}
}
if (import.meta.env.DEV) {
  const root = document.querySelector<HTMLElement>('[data-storybook-slice]');
  if (root) void mountSlice(root);
}
