/**
 * localStorage persistence (PLAN.md §5): one JSON key per store.
 *
 * DOM-free: the underlying Storage is injected, so `node --test` can cover
 * the logic with an in-memory fake. All reads are defensive — a missing key
 * or corrupt JSON falls back to the store's default instead of throwing.
 */

/**
 * Minimal Storage surface actually used. Satisfied by `localStorage` in the
 * browser and by a fake in tests.
 *
 * @typedef {object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/** localStorage key for `{ unitsPerMl, ... }`. */
export const SETTINGS_KEY = 'settings';
/** localStorage key for reconstitution presets. */
export const RECONSTITUTION_PRESETS_KEY = 'reconstitutionPresets';
/** localStorage key for dose presets. */
export const DOSE_PRESETS_KEY = 'dosePresets';
/** localStorage key for the history log. */
export const HISTORY_KEY = 'history';

/** History is capped to bound storage (PLAN.md §3.5). */
export const HISTORY_CAP = 200;

/** U-100 default (PLAN.md §3.3), used when settings are absent or invalid. */
export const DEFAULT_UNITS_PER_ML = 100;

/**
 * Create a JSON store bound to one key.
 *
 * @param {StorageLike} storage
 * @param {string} key
 * @param {unknown} fallback  Returned (by value) when the key is missing,
 *   unreadable, or holds corrupt JSON.
 * @returns {{ load(): unknown, save(value: unknown): boolean }}
 */
export function createStore(storage, key, fallback) {
  return {
    /**
     * @returns {unknown}
     */
    load() {
      let raw;
      try {
        raw = storage.getItem(key);
      } catch {
        return structuredClone(fallback);
      }
      if (raw === null) return structuredClone(fallback);
      try {
        return JSON.parse(raw);
      } catch {
        return structuredClone(fallback); // corrupt JSON — degrade, don't throw
      }
    },
    /**
     * @param {unknown} value
     * @returns {boolean} false on quota/security errors (data kept in memory).
     */
    save(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Bound the history list to its cap, keeping the *newest* entries
 * (FIFO: oldest dropped first). Pure.
 *
 * @param {unknown} history  Expected to be an array of entries.
 * @param {number} [cap]  Defaults to {@link HISTORY_CAP}.
 * @returns {unknown[]}
 */
export function capHistory(history, cap = HISTORY_CAP) {
  if (!Array.isArray(history)) return [];
  if (history.length <= cap) return history;
  return history.slice(history.length - cap);
}

/**
 * Read the settings store, validating `unitsPerMl` (whole number ≥ 1).
 * Anything invalid falls back to the U-100 default.
 *
 * @param {StorageLike} storage
 * @returns {{ unitsPerMl: number }}
 */
export function loadSettings(storage) {
  const fallback = { unitsPerMl: DEFAULT_UNITS_PER_ML };
  const raw = createStore(storage, SETTINGS_KEY, fallback).load();
  if (typeof raw !== 'object' || raw === null) return fallback;
  const unitsPerMl = /** @type {Record<string, unknown>} */ (raw)['unitsPerMl'];
  if (
    typeof unitsPerMl === 'number' &&
    Number.isInteger(unitsPerMl) &&
    unitsPerMl >= 1 &&
    unitsPerMl <= 100000
  ) {
    return { unitsPerMl };
  }
  return fallback;
}

/**
 * Persist settings.
 *
 * @param {StorageLike} storage
 * @param {{ unitsPerMl: number }} settings
 * @returns {boolean}
 */
export function saveSettings(storage, settings) {
  return createStore(storage, SETTINGS_KEY, {}).save(settings);
}
