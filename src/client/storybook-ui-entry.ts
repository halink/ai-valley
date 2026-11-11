/** Only the serve-only development HTML plugin injects this module. */
import {observerMap} from './main.js';
import {mountStorybookUIShell} from './storybook-ui-shell.js';
import './storybook-ui-shell.css';

if (import.meta.env.DEV) {
  const values = new URL(window.location.href).searchParams.getAll('storybook-ui');
  if (values.length === 1 && values[0] === '1') {
    try {
      const shell = mountStorybookUIShell(observerMap);
      if (import.meta.hot) import.meta.hot.dispose(() => shell.dispose());
    } catch {
      const notice = document.createElement('p'); notice.className = 'storybook-ui-launch'; notice.setAttribute('role', 'alert');
      notice.textContent = '绘本界面壳不可用，已保留原界面。'; document.getElementById('observer-hud')?.append(notice);
      if (import.meta.hot) import.meta.hot.dispose(() => notice.remove());
    }
  }
}
