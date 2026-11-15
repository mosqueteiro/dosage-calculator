/**
 * Tests for the storage layer (PLAN.md §5) with an in-memory Storage fake.
 * Run with: `npm test` (→ `node --test`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DISPLAY_MODE,
  DEFAULT_UNITS_PER_ML,
  HISTORY_CAP,
  capHistory,
  createStore,
  loadSettings,
  saveSettings,
} from '../src/js/lib/storage.js';

/** In-memory Storage double. */
class FakeStorage {
  /** @type {Map<string, string>} */
  #map = new Map();

  /**
   * @param {string} key
   * @returns {string | null}
   */
  getItem(key) {
    return this.#map.has(key) ? /** @type {string} */ (this.#map.get(key)) : null;
  }

  /**
   * @param {string} key
   * @param {string} value
   * @returns {void}
   */
  setItem(key, value) {
    this.#map.set(key, String(value));
  }
}

/** Storage double whose every method throws (quota / security errors). */
class BrokenStorage {
  /**
   * @returns {never}
   */
  getItem() {
    throw new Error('denied');
  }

  /**
   * @returns {never}
   */
  setItem() {
    throw new Error('quota exceeded');
  }
}

// ---------------------------------------------------------------------------
// createStore
// ---------------------------------------------------------------------------

test('createStore: JSON round-trip', () => {
  const storage = new FakeStorage();
  const store = createStore(storage, 'k', []);
  store.save([{ a: 1 }, { b: 'x' }]);
  assert.deepEqual(store.load(), [{ a: 1 }, { b: 'x' }]);
});

test('createStore: missing key returns the fallback', () => {
  const store = createStore(new FakeStorage(), 'missing', { unitsPerMl: 100 });
  assert.deepEqual(store.load(), { unitsPerMl: 100 });
});

test('createStore: fallback is returned by value (mutation-safe)', () => {
  const store = createStore(new FakeStorage(), 'missing', []);
  const loaded = /** @type {number[]} */ (store.load());
  loaded.push(999);
  assert.deepEqual(store.load(), []);
});

test('createStore: corrupt JSON returns the fallback', () => {
  const storage = new FakeStorage();
  storage.setItem('k', '{oops not json');
  const store = createStore(storage, 'k', { ok: true });
  assert.deepEqual(store.load(), { ok: true });
});

test('createStore: unreadable storage returns the fallback', () => {
  const store = createStore(new BrokenStorage(), 'k', []);
  assert.deepEqual(store.load(), []);
});

test('createStore: save reports failure when storage throws', () => {
  const store = createStore(new BrokenStorage(), 'k', []);
  assert.equal(store.save({ a: 1 }), false);
});

test('createStore: save reports success on a working storage', () => {
  const store = createStore(new FakeStorage(), 'k', []);
  assert.equal(store.save({ a: 1 }), true);
});

// ---------------------------------------------------------------------------
// capHistory
// ---------------------------------------------------------------------------

test('capHistory: keeps the newest entries when over the cap', () => {
  const entries = Array.from({ length: HISTORY_CAP + 50 }, (_, i) => ({ i }));
  const capped = capHistory(entries);
  assert.equal(capped.length, HISTORY_CAP);
  // Oldest dropped: first kept entry is index 50.
  assert.deepEqual(capped[0], { i: 50 });
  assert.deepEqual(capped[capped.length - 1], { i: entries.length - 1 });
});

test('capHistory: leaves lists at or under the cap untouched', () => {
  const entries = Array.from({ length: HISTORY_CAP }, (_, i) => ({ i }));
  assert.equal(capHistory(entries), entries);
  assert.deepEqual(capHistory([{ i: 1 }]), [{ i: 1 }]);
});

test('capHistory: empty and non-array inputs', () => {
  assert.deepEqual(capHistory([]), []);
  assert.deepEqual(capHistory('nope'), []);
  assert.deepEqual(capHistory(null), []);
});

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

test('loadSettings: defaults when nothing is stored', () => {
  assert.deepEqual(loadSettings(new FakeStorage()), {
    unitsPerMl: DEFAULT_UNITS_PER_ML,
    displayMode: DEFAULT_DISPLAY_MODE,
  });
});

test('loadSettings: valid stored values', () => {
  const storage = new FakeStorage();
  storage.setItem('settings', JSON.stringify({ unitsPerMl: 40, displayMode: 'dark' }));
  assert.deepEqual(loadSettings(storage), { unitsPerMl: 40, displayMode: 'dark' });
});

test('loadSettings: missing displayMode defaults to "system"', () => {
  const storage = new FakeStorage();
  storage.setItem('settings', JSON.stringify({ unitsPerMl: 40 }));
  assert.deepEqual(loadSettings(storage), { unitsPerMl: 40, displayMode: 'system' });
});

test('loadSettings: invalid values fall back to defaults', () => {
  for (const bad of ['100', 0, -5, 1.5, null, undefined]) {
    const storage = new FakeStorage();
    storage.setItem('settings', JSON.stringify({ unitsPerMl: bad }));
    assert.deepEqual(
      loadSettings(storage),
      { unitsPerMl: DEFAULT_UNITS_PER_ML, displayMode: 'system' },
      `unitsPerMl: ${JSON.stringify(bad)}`,
    );
  }
  for (const badMode of ['blue', 1, null, '']) {
    const storage = new FakeStorage();
    storage.setItem('settings', JSON.stringify({ unitsPerMl: 40, displayMode: badMode }));
    assert.deepEqual(
      loadSettings(storage),
      { unitsPerMl: 40, displayMode: 'system' },
      `displayMode: ${JSON.stringify(badMode)}`,
    );
  }
});

test('loadSettings: corrupt JSON falls back to defaults', () => {
  const storage = new FakeStorage();
  storage.setItem('settings', 'not json');
  assert.deepEqual(loadSettings(storage), {
    unitsPerMl: DEFAULT_UNITS_PER_ML,
    displayMode: DEFAULT_DISPLAY_MODE,
  });
});

test('saveSettings/loadSettings round-trip', () => {
  const storage = new FakeStorage();
  assert.equal(saveSettings(storage, { unitsPerMl: 50, displayMode: 'light' }), true);
  assert.deepEqual(loadSettings(storage), { unitsPerMl: 50, displayMode: 'light' });
});
