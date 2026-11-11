/** Injected only by the existing development observer server's explicit URL switch. */
import {observerMap, observerScene} from './main.js';
import {mountIsometricObserver} from './isometric-observer.js';
import {mountStorybookDevelopmentPreview} from './storybook-development-preview.js';
if (import.meta.env.DEV) {
  const values = new URL(window.location.href).searchParams.getAll('storybook');
  if (values.length === 1 && values[0] === '1') {
    try {
      const view = mountStorybookDevelopmentPreview(observerMap, observerScene, mountIsometricObserver(observerMap));
      if (import.meta.hot) import.meta.hot.dispose(() => view.dispose());
    } catch {console.warn('Development diagnostic preview unavailable; original view retained.');}
  }
}
