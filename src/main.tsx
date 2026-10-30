import { h, mount } from './ui/dom.ts';
import { App } from './ui/App.tsx';
import { loadCustomFonts, loadImages } from './app/state.ts';
import { setupAutoReconnect, tryRestorePort } from './app/actions.ts';
import * as actions from './app/actions.ts';
import { app } from './app/state.ts';

void h;

mount(document.getElementById('app')!, () => <App />);

// для отладки из консоли браузера: plotterm.app, plotterm.actions
(window as any).plotterm = { app, actions };

loadCustomFonts();
loadImages();
setupAutoReconnect();
tryRestorePort();

// офлайн-работа и установка как приложение
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
