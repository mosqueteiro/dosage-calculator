/**
 * Presets UI (PLAN.md §3.4): named reconstitution and dose presets,
 * persisted in localStorage, loadable back into the calculator.
 */
import { parseMass, parseVolumeMl, unitsToMicroliters } from '../lib/calc.js';
import {
  DOSE_PRESETS_KEY,
  RECONSTITUTION_PRESETS_KEY,
  createStore,
} from '../lib/storage.js';
import { CalcError } from '../lib/calc.js';

/**
 * @typedef {object} ReconstitutionPreset
 * @property {string} id
 * @property {string} name
 * @property {string} vialAmount
 * @property {'mg' | 'mcg'} vialUnit
 * @property {string} diluentMl
 * @property {number} createdAt
 */

/**
 * @typedef {object} DosePreset
 * @property {string} id
 * @property {string} name
 * @property {string} doseAmount
 * @property {import('./calculator.js').DoseField} doseUnit
 * @property {string} [linkedPresetId]
 * @property {number} createdAt
 */

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
 * @param {HTMLInputElement | HTMLSelectElement} input
 * @returns {string}
 */
const trimmed = (input) => input.value.trim();

/**
 * Build one list item row for a preset with Load and Delete actions.
 *
 * @param {{
 *   name: string,
 *   summary: string,
 *   loadLabel?: string,
 *   onLoad(): void,
 *   onDelete(): void,
 *   badge?: string,
 * }} spec
 * @returns {HTMLLIElement}
 */
function presetItem({ name, summary, loadLabel = 'Load', onLoad, onDelete, badge }) {
  const li = document.createElement('li');
  li.className = 'item';

  const main = document.createElement('span');
  main.className = 'item-main';
  const nameEl = document.createElement('span');
  nameEl.className = 'item-name';
  nameEl.textContent = name;
  const subEl = document.createElement('span');
  subEl.className = 'item-sub';
  subEl.textContent = summary;
  main.append(nameEl, subEl);

  const actions = document.createElement('span');
  actions.className = 'item-actions';
  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'btn';
  loadBtn.textContent = loadLabel;
  loadBtn.addEventListener('click', onLoad);
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-icon';
  deleteBtn.setAttribute('aria-label', `Delete ${name}`);
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', onDelete);
  actions.append(loadBtn, deleteBtn);

  li.append(main, actions);
  if (badge) {
    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge';
    badgeEl.textContent = badge;
    li.append(badgeEl);
  }
  return li;
}

/**
 * Show or clear a form warning.
 *
 * @param {HTMLElement} el
 * @param {string} message  Empty string hides the element.
 * @returns {void}
 */
function setWarning(el, message) {
  el.textContent = message;
  el.hidden = message === '';
}

/**
 * Wire both preset lists and their save forms.
 *
 * @param {import('./calculator.js').CalculatorController} controller
 * @returns {void}
 */
export function initPresets(controller) {
  const recStore =
    createStore(localStorage, RECONSTITUTION_PRESETS_KEY, /** @type {ReconstitutionPreset[]} */ ([]));
  const doseStore =
    createStore(localStorage, DOSE_PRESETS_KEY, /** @type {DosePreset[]} */ ([]));

  const recName = /** @type {HTMLInputElement} */ (byId('rec-preset-name'));
  const recWarning = byId('rec-preset-warning');
  const recList = byId('rec-preset-list');

  const doseName = /** @type {HTMLInputElement} */ (byId('dose-preset-name'));
  const doseLink = /** @type {HTMLSelectElement} */ (byId('dose-preset-link'));
  const doseWarning = byId('dose-preset-warning');
  const doseList = byId('dose-preset-list');
  const doseSourceHint = byId('dose-preset-source');

  // --- Reconstitution presets ---------------------------------------------

  function renderRecPresets() {
    const presets = /** @type {ReconstitutionPreset[]} */ (recStore.load());
    recList.textContent = '';
    if (presets.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No reconstitution presets yet.';
      recList.append(li);
    }
    for (const preset of presets) {
      recList.append(presetItem({
        name: preset.name,
        summary: `${preset.vialAmount} ${preset.vialUnit} · ${preset.diluentMl} mL`,
        onLoad: () => controller.loadReconstitution(preset),
        onDelete: () => {
          recStore.save(
            /** @type {ReconstitutionPreset[]} */ (recStore.load())
              .filter((p) => p.id !== preset.id),
          );
          renderRecPresets();
        },
      }));
    }
    refreshLinkOptions();
  }

  byId('save-rec-preset').addEventListener('click', () => {
    const name = trimmed(recName);
    const current = controller.getReconstitutionInputs();
    if (name === '') {
      setWarning(recWarning, 'Give the preset a name.');
      return;
    }
    try {
      parseMass(current.vialAmount, current.vialUnit);
      parseVolumeMl(current.diluentMl);
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      setWarning(recWarning, 'Enter a valid vial amount and diluent volume first.');
      return;
    }
    /** @type {ReconstitutionPreset} */
    const preset = {
      id: crypto.randomUUID(),
      name,
      vialAmount: current.vialAmount,
      vialUnit: current.vialUnit,
      diluentMl: current.diluentMl,
      createdAt: Date.now(),
    };
    const presets = /** @type {ReconstitutionPreset[]} */ (recStore.load());
    presets.push(preset);
    recStore.save(presets);
    recName.value = '';
    setWarning(recWarning, '');
    renderRecPresets();
  });

  // --- Dose presets ---------------------------------------------------------

  function refreshLinkOptions() {
    const presets = /** @type {ReconstitutionPreset[]} */ (recStore.load());
    const selected = doseLink.value;
    doseLink.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '(no linked vial)';
    doseLink.append(none);
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      doseLink.append(option);
    }
    if (presets.some((p) => p.id === selected)) doseLink.value = selected;
  }

  /**
   * @param {string} id
   * @returns {string | null}
   */
  function linkedName(id) {
    const presets = /** @type {ReconstitutionPreset[]} */ (recStore.load());
    return presets.find((p) => p.id === id)?.name ?? null;
  }

  function renderDosePresets() {
    const presets = /** @type {DosePreset[]} */ (doseStore.load());
    doseList.textContent = '';
    if (presets.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No dose presets yet.';
      doseList.append(li);
    }
    for (const preset of presets) {
      const linkName = preset.linkedPresetId ? linkedName(preset.linkedPresetId) : null;
      doseList.append(presetItem({
        name: preset.name,
        summary: `${preset.doseAmount} ${preset.doseUnit}` +
          (linkName ? ` · ${linkName}` : ''),
        loadLabel: 'Load',
        badge: linkName ? 'with vial' : undefined,
        onLoad: () => {
          if (preset.linkedPresetId) {
            const linked = /** @type {ReconstitutionPreset[]} */ (recStore.load())
              .find((p) => p.id === preset.linkedPresetId);
            if (linked) controller.loadReconstitution(linked);
          }
          controller.loadDoseIntoActive(preset);
        },
        onDelete: () => {
          doseStore.save(
            /** @type {DosePreset[]} */ (doseStore.load())
              .filter((p) => p.id !== preset.id),
          );
          renderDosePresets();
        },
      }));
    }
  }

  byId('save-dose-preset').addEventListener('click', () => {
    const name = trimmed(doseName);
    const source = controller.getActiveDoseSource();
    const amount = source.value.trim();

    if (name === '') {
      setWarning(doseWarning, 'Give the preset a name.');
      return;
    }
    if (amount === '') {
      setWarning(doseWarning, 'Type a dose first — it is saved from the panel you last edited.');
      return;
    }
    try {
      if (source.field === 'mg') parseMass(amount, 'mg');
      else if (source.field === 'mcg') parseMass(amount, 'mcg');
      else if (source.field === 'ml') parseVolumeMl(amount);
      else unitsToMicroliters(amount, controller.getUnitsPerMl());
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      setWarning(doseWarning, `Dose (${source.field}) is not a valid number.`);
      return;
    }

    const linkedPresetId = doseLink.value || undefined;
    /** @type {DosePreset} */
    const preset = {
      id: crypto.randomUUID(),
      name,
      doseAmount: amount,
      doseUnit: source.field,
      linkedPresetId,
      createdAt: Date.now(),
    };
    const presets = /** @type {DosePreset[]} */ (doseStore.load());
    presets.push(preset);
    doseStore.save(presets);
    doseName.value = '';
    setWarning(doseWarning, '');
    renderDosePresets();
  });

  // --- Shared wiring ----------------------------------------------------------

  const updateSourceHint = () => {
    doseSourceHint.textContent = `Saves from: ${controller.getActivePanel()}`;
  };
  document.addEventListener('input', updateSourceHint);
  updateSourceHint();

  renderRecPresets();
  renderDosePresets();
}
