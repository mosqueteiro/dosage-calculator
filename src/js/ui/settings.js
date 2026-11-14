/**
 * Settings UI: syringe calibration (units per mL, PLAN.md §3.3).
 * U-100 (100 units/mL) is the default; other insulin syringes (U-40, U-50…)
 * are supported by changing this value. Persisted in the settings store.
 */
import { CalcError, CalcErrorCode, parseUnitsPerMl } from '../lib/calc.js';
import { saveSettings } from '../lib/storage.js';

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
 * Wire the units-per-mL field to the calculator and persist changes.
 *
 * @param {import('./calculator.js').CalculatorController} controller
 * @returns {void}
 */
export function initSettings(controller) {
  const input = /** @type {HTMLInputElement} */ (byId('units-per-ml'));
  const warning = byId('units-per-ml-warning');

  input.value = String(controller.getUnitsPerMl());

  input.addEventListener('input', () => {
    try {
      const unitsPerMl = parseUnitsPerMl(input.value);
      controller.setUnitsPerMl(unitsPerMl);
      saveSettings(localStorage, { unitsPerMl });
      warning.hidden = true;
    } catch (err) {
      if (!(err instanceof CalcError)) throw err;
      warning.textContent =
        err.code === CalcErrorCode.ZERO_UNITS_PER_ML
          ? 'Units per mL must be at least 1.'
          : 'Enter a whole number ≥ 1 (100 = U-100).';
      warning.hidden = false;
    }
  });
}
