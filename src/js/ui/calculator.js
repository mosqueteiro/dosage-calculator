/**
 * Calculator UI: reconstitution + quick-dose modes, bidirectional dose
 * units (mg / mcg / mL / syringe units), and non-blocking inline warnings.
 *
 * Milestone 2 scope: U-100 syringe default (100 units/mL). Settings,
 * presets, and history arrive in later milestones. No persistence yet.
 */
import {
  CalcError,
  CalcErrorCode,
  computeConcentration,
  computeDrawVolume,
  computeDoseFromVolume,
  concentrationMgPerMl,
  doseExceedsVial,
  drawExceedsDiluent,
  microlitersToMlString,
  microlitersToUnits,
  microgramsToMcgString,
  microgramsToMgString,
  parseConcentrationMgPerMl,
  parseMass,
  parseUnitsPerMl,
  parseVolumeMl,
  unitsToMicroliters,
} from '../lib/calc.js';

/** U-100 insulin syringe is the default (Settings arrives in a later milestone). */
const UNITS_PER_ML = parseUnitsPerMl('100');

/** @typedef {'mg' | 'mcg' | 'ml' | 'units'} DoseField */

/** @type {readonly DoseField[]} */
const FIELDS = ['mg', 'mcg', 'ml', 'units'];

/** @type {Record<DoseField, string>} */
const FIELD_LABELS = {
  mg: 'Dose (mg)',
  mcg: 'Dose (mcg)',
  ml: 'Dose (mL)',
  units: 'Dose (units)',
};

/**
 * Context a mode provides before dose math can run.
 *
 * @typedef {object} ConcentrationContext
 * @property {import('../lib/calc.js').Concentration | null} concentration
 * @property {string[]} inputWarnings  Warnings about this mode's own inputs.
 * @property {import('../lib/calc.js').Micrograms} [vialUg]  Reconstitution only.
 * @property {import('../lib/calc.js').Microliters} [diluentUl]  Reconstitution only.
 */

/**
 * A dose-group instance: the four bidirectional dose fields plus result
 * readouts, wired to a mode-specific concentration source.
 *
 * @typedef {object} DoseGroupConfig
 * @property {Record<DoseField, HTMLInputElement>} dose
 * @property {HTMLElement} warnings
 * @property {HTMLElement} drawOut
 * @property {HTMLElement} unitsOut
 * @property {() => ConcentrationContext} getConcentration
 * @property {string} volumeHint  Shown when dose mass is known but no concentration.
 * @property {string} massHint  Shown when draw volume is known but no concentration.
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
 * Map a CalcError code to a short, human-friendly fragment that reads well
 * after a field label (e.g. "Dose (mg) is not a valid number").
 *
 * @param {CalcError} err
 * @returns {string}
 */
function friendlyMessage(err) {
  switch (err.code) {
    case CalcErrorCode.INVALID:
      return 'is not a valid number';
    case CalcErrorCode.PRECISION:
      return 'has too many decimal places';
    case CalcErrorCode.RANGE:
      return 'is too large';
    case CalcErrorCode.ZERO_DILUENT:
      return 'Diluent volume must be greater than zero.';
    case CalcErrorCode.ZERO_VIAL:
      return 'Vial amount must be greater than zero.';
    case CalcErrorCode.ZERO_UNITS_PER_ML:
      return 'Units per mL must be greater than zero.';
    default:
      return err.message;
  }
}

/**
 * Render the warnings list; hidden when empty.
 *
 * @param {HTMLElement} el
 * @param {string[]} warnings
 * @returns {void}
 */
function renderWarnings(el, warnings) {
  el.textContent = '';
  if (warnings.length === 0) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const ul = document.createElement('ul');
  for (const warning of warnings) {
    const li = document.createElement('li');
    li.textContent = warning;
    ul.append(li);
  }
  el.append(ul);
}

/**
 * Toggle the ≈ marker next to a dose field.
 *
 * @param {HTMLElement | null | undefined} el
 * @param {boolean} shown
 * @returns {void}
 */
function setApprox(el, shown) {
  if (el) el.hidden = !shown;
}

// ---------------------------------------------------------------------------
// Mode panels
// ---------------------------------------------------------------------------

/**
 * Wire up the mode tabs (click + arrow-key navigation).
 *
 * @returns {void}
 */
function initModeTabs() {
  const tabs = [byId('tab-reconstitution'), byId('tab-quickdose')];
  const panels = [byId('panel-reconstitution'), byId('panel-quickdose')];

  /**
   * @param {number} selected
   * @returns {void}
   */
  function select(selected) {
    tabs.forEach((tab, i) => {
      const panel = panels[i];
      if (!panel) return;
      tab.setAttribute('aria-selected', String(i === selected));
      tab.tabIndex = i === selected ? 0 : -1;
      panel.hidden = i !== selected;
    });
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length
        : null;
      if (next === null) return;
      tabs[next]?.focus();
      select(next);
      event.preventDefault();
    });
  });
}

/**
 * Reconstitution mode: vial amount + diluent → concentration, then dose.
 *
 * @returns {void}
 */
function initReconstitutionPanel() {
  const vialInput = /** @type {HTMLInputElement} */ (byId('rec-vial'));
  const vialUnit = /** @type {HTMLSelectElement} */ (byId('rec-vial-unit'));
  const diluentInput = /** @type {HTMLInputElement} */ (byId('rec-diluent'));
  const concentrationOut = byId('rec-concentration-out');

  const dose = {
    mg: /** @type {HTMLInputElement} */ (byId('rec-dose-mg')),
    mcg: /** @type {HTMLInputElement} */ (byId('rec-dose-mcg')),
    ml: /** @type {HTMLInputElement} */ (byId('rec-dose-ml')),
    units: /** @type {HTMLInputElement} */ (byId('rec-dose-units')),
  };

  const HINT =
    'Enter the vial amount and diluent volume to compute the rest.';

  /**
   * Parse vial + diluent into a concentration (plus warnings and the
   * guardrail context the dose group needs).
   *
   * @returns {ConcentrationContext}
   */
  function getConcentration() {
    const inputWarnings = [];
    /** @type {import('../lib/calc.js').Micrograms | undefined} */
    let vialUg;
    /** @type {import('../lib/calc.js').Microliters | undefined} */
    let diluentUl;

    if (vialInput.value.trim() !== '') {
      try {
        vialUg = parseMass(vialInput.value, /** @type {'mg' | 'mcg'} */ (vialUnit.value));
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        inputWarnings.push(`Vial amount ${friendlyMessage(err)}`);
      }
    }
    if (diluentInput.value.trim() !== '') {
      try {
        diluentUl = parseVolumeMl(diluentInput.value);
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        inputWarnings.push(`Diluent volume ${friendlyMessage(err)}`);
      }
    }

    let concentration = null;
    if (vialUg !== undefined && diluentUl !== undefined) {
      try {
        concentration = computeConcentration({ vialUg, diluentUl });
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        inputWarnings.push(friendlyMessage(err));
      }
    }

    concentrationOut.textContent = concentration
      ? `${concentrationMgPerMl(concentration)} mg/mL`
      : '—';

    return { concentration, inputWarnings, vialUg, diluentUl };
  }

  const doseGroup = setupDoseGroup({
    dose,
    warnings: byId('rec-warnings'),
    drawOut: byId('rec-draw-out'),
    unitsOut: byId('rec-units-out'),
    getConcentration,
    volumeHint: HINT,
    massHint: HINT,
  });

  for (const el of [vialInput, diluentInput]) {
    el.addEventListener('input', () => doseGroup.refresh());
  }
  vialUnit.addEventListener('change', () => doseGroup.refresh());
}

/**
 * Quick dose mode: known concentration → dose volume.
 *
 * @returns {void}
 */
function initQuickDosePanel() {
  const concInput = /** @type {HTMLInputElement} */ (byId('quick-conc'));

  const dose = {
    mg: /** @type {HTMLInputElement} */ (byId('quick-dose-mg')),
    mcg: /** @type {HTMLInputElement} */ (byId('quick-dose-mcg')),
    ml: /** @type {HTMLInputElement} */ (byId('quick-dose-ml')),
    units: /** @type {HTMLInputElement} */ (byId('quick-dose-units')),
  };

  const HINT = 'Enter the known concentration to compute the rest.';

  /**
   * Parse the concentration field. Values are limited to 3 decimals by the
   * internal µg resolution (e.g. 0.25 mg/mL), which is far beyond the
   * precision of any realistic reconstitution.
   *
   * @returns {ConcentrationContext}
   */
  function getConcentration() {
    const inputWarnings = [];
    let concentration = null;

    if (concInput.value.trim() !== '') {
      try {
        concentration = parseConcentrationMgPerMl(concInput.value);
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        inputWarnings.push(
          err.code === CalcErrorCode.ZERO_VIAL
            ? 'Concentration must be greater than zero.'
            : `Concentration ${friendlyMessage(err)}`,
        );
      }
    }

    return { concentration, inputWarnings };
  }

  const doseGroup = setupDoseGroup({
    dose,
    warnings: byId('quick-warnings'),
    drawOut: byId('quick-draw-out'),
    unitsOut: byId('quick-units-out'),
    getConcentration,
    volumeHint: HINT,
    massHint: HINT,
  });

  concInput.addEventListener('input', () => doseGroup.refresh());
}

/**
 * Wire one dose group: four bidirectional fields (mg / mcg / mL / units),
 * result readouts, and warnings. The field being edited is the source of
 * truth; every other field is derived and updated live.
 *
 * @param {DoseGroupConfig} config
 * @returns {{ refresh(): void }}
 */
function setupDoseGroup(config) {
  /** @type {DoseField} */
  let source = 'mg';

  /** @type {Partial<Record<DoseField, HTMLElement | null>>} */
  const approxEls = {};
  for (const field of FIELDS) {
    const input = config.dose[field];
    approxEls[field] =
      /** @type {HTMLElement | null} */
      (input.closest('.field')?.querySelector('.approx') ?? null);
    input.addEventListener('input', () => {
      source = field;
      update();
    });
  }

  function update() {
    const ctx = config.getConcentration();
    const warnings = [...ctx.inputWarnings];

    /** @type {Partial<Record<DoseField, string>>} */
    const values = {};
    /** @type {Partial<Record<DoseField, boolean>>} */
    const approx = {};

    /** @type {import('../lib/calc.js').Micrograms | null} */
    let doseUg = null;
    /** @type {import('../lib/calc.js').Microliters | null} */
    let drawUl = null;
    let doseRounded = false;
    let drawRounded = false;

    // Parse the source field (empty → nothing derived, clear everything).
    const raw = config.dose[source].value.trim();
    if (raw !== '') {
      try {
        if (source === 'mg') {
          doseUg = parseMass(raw, 'mg');
        } else if (source === 'mcg') {
          doseUg = parseMass(raw, 'mcg');
        } else if (source === 'ml') {
          drawUl = parseVolumeMl(raw);
        } else {
          const fromUnits = unitsToMicroliters(raw, UNITS_PER_ML);
          drawUl = fromUnits.value;
          drawRounded = fromUnits.rounded;
        }
      } catch (err) {
        if (!(err instanceof CalcError)) throw err;
        warnings.push(`${FIELD_LABELS[source]} ${friendlyMessage(err)}`);
      }
    }

    // Link dose mass ↔ draw volume through the concentration.
    if (doseUg !== null && drawUl === null && ctx.concentration) {
      const result = computeDrawVolume({ doseUg, concentration: ctx.concentration });
      drawUl = result.value;
      drawRounded = result.rounded;
    }
    if (drawUl !== null && doseUg === null && ctx.concentration) {
      const result = computeDoseFromVolume({ drawUl, concentration: ctx.concentration });
      doseUg = result.value;
      doseRounded = result.rounded;
    }

    // Fill dose-mass fields.
    if (doseUg !== null) {
      if (source !== 'mg') {
        values.mg = microgramsToMgString(doseUg);
        approx.mg = doseRounded;
      }
      if (source !== 'mcg') {
        values.mcg = microgramsToMcgString(doseUg);
        approx.mcg = doseRounded;
      }
      if (doseUg === 0) warnings.push('Dose is zero — nothing to draw.');
    } else if (drawUl !== null && !ctx.concentration) {
      warnings.push(config.massHint);
    }

    // Fill dose-volume fields and the result readouts.
    if (drawUl !== null) {
      if (source !== 'ml') {
        values.ml = microlitersToMlString(drawUl);
        approx.ml = drawRounded;
      }
      const unitsOut = microlitersToUnits(drawUl, UNITS_PER_ML);
      if (source !== 'units') {
        values.units = String(unitsOut.value);
        approx.units = unitsOut.rounded;
      }
      const mlText = microlitersToMlString(drawUl);
      config.drawOut.textContent = drawRounded
        ? `≈ ${mlText} mL`
        : `${mlText} mL`;
      config.unitsOut.textContent = unitsOut.rounded
        ? `≈ ${unitsOut.value} units`
        : `${unitsOut.value} ${unitsOut.value === 1 ? 'unit' : 'units'}`;
    } else {
      config.drawOut.textContent = '—';
      config.unitsOut.textContent = '—';
      if (doseUg !== null && !ctx.concentration) {
        warnings.push(config.volumeHint);
      }
    }

    // Safety guardrails (visible, not blocking).
    if (ctx.vialUg !== undefined && doseUg !== null && doseExceedsVial(doseUg, ctx.vialUg)) {
      warnings.push('Dose exceeds the vial’s total content.');
    }
    if (ctx.diluentUl !== undefined && drawUl !== null && drawExceedsDiluent(drawUl, ctx.diluentUl)) {
      warnings.push('Draw volume exceeds the total diluent volume.');
    }

    // Apply derived values (never overwrite the field being edited).
    for (const field of FIELDS) {
      const input = config.dose[field];
      if (field !== source) {
        input.value = values[field] ?? '';
      }
      setApprox(approxEls[field], approx[field] === true);
    }
    renderWarnings(config.warnings, warnings);
  }

  // Initial state: results blank, warnings hidden.
  update();

  return { refresh: update };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Initialise the whole calculator (tabs + both modes).
 *
 * @returns {void}
 */
export function initCalculator() {
  initModeTabs();
  initReconstitutionPanel();
  initQuickDosePanel();
}
