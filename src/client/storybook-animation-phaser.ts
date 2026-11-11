/** Optional development adapter for an existing dedicated Phaser scene. Never constructs a Game. */
import type Phaser from 'phaser';
import type {ObserverMap} from './observer-map.js';
import type {StorybookPixelAtlas} from './storybook-render-plan.js';
import type {StorybookAnimationBundle} from './storybook-animation-assets.js';
import {mountStorybookSurface, type StorybookViewport} from './storybook-phaser.js';
import {createStorybookAnimatedObserver, type StorybookAnimatedObserverHandle, type StorybookAnimationEnvironment} from './storybook-animated-observer.js';

/** Browser events sample flags immediately, even when the caller's scene has stopped ticking. */
export function storybookBrowserAnimationEnvironment(): StorybookAnimationEnvironment {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    now: () => performance.now(), visible: () => document.visibilityState === 'visible', reducedMotion: () => media.matches,
    subscribeChange(listener) {
      document.addEventListener('visibilitychange', listener);
      try {media.addEventListener('change', listener);} catch (error) {document.removeEventListener('visibilitychange', listener); throw error;}
      return () => {document.removeEventListener('visibilitychange', listener); media.removeEventListener('change', listener);};
    },
  };
}
export function mountStorybookAnimationPrototype(scene: Phaser.Scene, observer: ObserverMap, atlas: StorybookPixelAtlas, bundle: StorybookAnimationBundle, viewport: StorybookViewport, environment?: StorybookAnimationEnvironment): StorybookAnimatedObserverHandle {
  return mountStorybookSurface(scene, observer, atlas, viewport, 'animation', (owned, surface) => {
    const controller = createStorybookAnimatedObserver(observer, owned, bundle, surface, environment ?? storybookBrowserAnimationEnvironment());
    const tick = () => {controller.tick();};
    try {scene.events.on('preupdate', tick);} catch (error) {controller.dispose(); throw error;}
    let disposed = false;
    return {
      activate: () => controller.activate(), deactivate: () => controller.deactivate(), setWindow: value => controller.setWindow(value), tick,
      get plan() {return controller.plan;}, get playback() {return controller.playback;},
      dispose() {if (disposed) return; disposed = true; scene.events.off('preupdate', tick); controller.dispose();},
    };
  });
}
