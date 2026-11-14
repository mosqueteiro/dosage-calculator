/**
 * History log UI (PLAN.md §3.5): timestamped list of completed calculations,
 * newest first. Tap an entry to reload its inputs into the calculator;
 * entries are individually deletable; "clear all" asks for confirmation.
 * Capped at HISTORY_CAP entries in storage.
 */
import { HISTORY_CAP, HISTORY_KEY, capHistory, createStore } from '../lib/storage.js';

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
 * Human-readable one-line summary of a stored entry: inputs → results.
 *
 * @param {import('./calculator.js').HistoryEntry} entry
 * @returns {string}
 */
function describe(entry) {
  const { inputs, results } = entry;
  const dose = `dose ${inputs.doseValue} ${inputs.doseUnit}`;

  let context;
  if ('concentrationMgPerMl' in inputs) {
    context = `${inputs.concentrationMgPerMl} mg/mL`;
  } else {
    context = `${inputs.vialAmount} ${inputs.vialUnit} in ${inputs.diluentMl} mL`;
  }

  let out = `→ ${results.drawMl} mL · ${results.syringeUnits} u`;
  if (entry.mode === 'reconstitution' && results.concentrationMgPerMl) {
    out += ` · ${results.concentrationMgPerMl} mg/mL`;
  }
  return `${context} · ${dose} ${out}`;
}

/**
 * Short relative-ish timestamp for the entry line.
 *
 * @param {number} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Wire the history list to the calculator's completed-calculation events.
 *
 * @param {import('./calculator.js').CalculatorController} controller
 * @returns {void}
 */
export function initHistory(controller) {
  const store = createStore(localStorage, HISTORY_KEY, /** @type {import('./calculator.js').HistoryEntry[]} */ ([]));
  const list = byId('history-list');
  const count = byId('history-count');

  function render() {
    const entries = /** @type {import('./calculator.js').HistoryEntry[]} */ (store.load());
    count.textContent = entries.length > 0 ? `${entries.length} / ${HISTORY_CAP}` : '';
    list.textContent = '';

    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No history yet — completed calculations appear here.';
      list.append(li);
      return;
    }

    // Newest first (storage order is oldest → newest).
    for (const entry of [...entries].reverse()) {
      const li = document.createElement('li');
      li.className = 'item';

      const load = document.createElement('button');
      load.type = 'button';
      load.className = 'entry-load';
      load.title = 'Load these inputs into the calculator';
      const time = document.createElement('span');
      time.className = 'entry-time';
      time.textContent = formatTime(entry.timestamp);
      const text = document.createElement('span');
      text.className = 'entry-text';
      text.textContent = describe(entry);
      load.append(time, text);
      load.addEventListener('click', () => controller.loadHistoryEntry(entry));

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = entry.mode === 'reconstitution' ? 'recon' : 'quick';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-icon';
      deleteBtn.setAttribute('aria-label', 'Delete entry');
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => {
        store.save(
          /** @type {import('./calculator.js').HistoryEntry[]} */ (store.load())
            .filter((e) => e.id !== entry.id),
        );
        render();
      });

      li.append(load, badge, deleteBtn);
      list.append(li);
    }
  }

  // Every completed calculation is appended (capped, FIFO).
  controller.onCalculationComplete((entry) => {
    const entries = /** @type {import('./calculator.js').HistoryEntry[]} */ (store.load());
    entries.push(entry);
    store.save(capHistory(entries, HISTORY_CAP));
    render();
  });

  byId('clear-history').addEventListener('click', () => {
    const hasEntries = /** @type {import('./calculator.js').HistoryEntry[]} */ (store.load()).length > 0;
    if (!hasEntries) return;
    if (window.confirm('Clear all history? This cannot be undone.')) {
      store.save([]);
      render();
    }
  });

  render();
}
