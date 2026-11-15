/**
 * Display mode (PLAN.md §5 settings): "system" follows the OS preference,
 * "light"/"dark" force a theme via <html data-theme="…">. Also keeps the
 * theme-color meta tags in sync with the effective theme.
 */
import { loadSettings, saveSettings } from '../lib/storage.js';

const THEME_COLORS = /** @type {const} */ ({
  light: '#2563eb',
  dark: '#101012',
});

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/**
 * Apply a display mode to the document and the theme-color metas.
 *
 * @param {'system' | 'light' | 'dark'} mode
 * @returns {void}
 */
export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', mode);
  }

  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  if (mode === 'system') {
    // Restore the media-scoped pair from index.html.
    if (metas[0]) {
      metas[0].setAttribute('content', THEME_COLORS.light);
      metas[0].setAttribute('media', '(prefers-color-scheme: light)');
    }
    if (metas[1]) {
      metas[1].setAttribute('content', THEME_COLORS.dark);
      metas[1].setAttribute('media', '(prefers-color-scheme: dark)');
    }
  } else {
    // Forced theme: one unconditional color for both tags.
    for (const meta of metas) {
      meta.setAttribute('content', THEME_COLORS[mode]);
      meta.removeAttribute('media');
    }
  }
}

/**
 * Wire the Display mode select: apply the stored value on load, persist and
 * apply changes. Saves merge into the full settings store so the units
 * setting is preserved.
 *
 * @returns {void}
 */
export function initTheme() {
  const select = /** @type {HTMLSelectElement} */ (byId('display-mode'));
  const initial = loadSettings(localStorage).displayMode;
  select.value = initial;
  applyTheme(initial);

  select.addEventListener('change', () => {
    const mode = /** @type {'system' | 'light' | 'dark'} */ (select.value);
    applyTheme(mode);
    saveSettings(localStorage, { ...loadSettings(localStorage), displayMode: mode });
  });
}
