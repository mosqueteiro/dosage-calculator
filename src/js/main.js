/**
 * Application entry point.
 */
import { initCalculator } from './ui/calculator.js';
import { initPresets } from './ui/presets.js';
import { initHistory } from './ui/history.js';
import { initSettings } from './ui/settings.js';

const controller = initCalculator();
initPresets(controller);
initHistory(controller);
initSettings(controller);

// PWA: offline app shell. Relative registration/scope so it works on
// GitHub Pages project sites (/<repo>/), not just at a domain root.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
