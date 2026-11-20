import { h, mount } from "./ui/dom.js";
import { App } from "./ui/App.js";
import { loadCustomFonts, loadImages } from "./app/state.js";
import { setupAutoReconnect, tryRestorePort } from "./app/actions.js";
import * as actions from "./app/actions.js";
import { app } from "./app/state.js";
void h;
mount(document.getElementById('app'), () => h(App, null));
// для отладки из консоли браузера: plotterm.app, plotterm.actions
window.plotterm = { app, actions };
loadCustomFonts();
loadImages();
setupAutoReconnect();
tryRestorePort();
// офлайн-работа и установка как приложение
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
}
