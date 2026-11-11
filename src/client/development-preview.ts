/** Serve-only compatibility entry. The ordinary client already mounts the same observer. */
import {observerMap} from './main.js';
import {mountIsometricObserver} from './isometric-observer.js';
const observer=mountIsometricObserver(observerMap);
if(import.meta.hot)import.meta.hot.dispose(()=>observer.dispose());
