/**
 * Calculator UI: reconstitution + quick-dose modes, bidirectional dose
 * units (mg / mcg / mL / syringe units), and non-blocking inline warnings.
 *
 * Also exposes a controller used by the presets/history/settings modules:
 * loading values into the calculator, reading the active dose, changing the
 * syringe calibration, and subscribing to completed calculations
 * (debounced — PLAN.md §3.5 "every completed calculation" means a settled,
 * complete state, not every keystroke).
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
import { loadSettings } from '../lib/storage.js';

/** U-100 insulin syringe is the default; user-configurable via Settings. */
export const DEFAULT_UNITS_PER_ML = 100;

/** How long typing must pause before a calculation counts as "completed". */
const LOG_DEBOUNCE_MS = 600;

/** @typedef {'mg' | 'mcg' | 'ml' | 'units'} DoseField */
/** @typedef {'reconstitution' | 'quick-dose'} Mode */

/** @type {readonly DoseField[]} */
const FIELDS = ['mg', 'mcg', 'ml', 'units'];

/** @type {Record<DoseField, string>} */
const FIELD_LABELS = {
  mg: 'Dose (mg)',
  mcg: 'Dose (mcg)',
  ml: 'Dose (mL)',
  units: 'Dose (units)',
};

// ---------------------------------------------------------------------------
// Shared types (consumed by ui/presets.js and ui/history.js)
// ---------------------------------------------------------------------------

/**
 * Inputs of a completed reconstitution calculation, as typed by the user.
 * @typedef {object} RecInputs
 * @property {string} vialAmount
 * @property {'mg' | 'mcg'} vialUnit
 * @property {string} diluentMl
 * @property {string} doseValue
 * @property {DoseField} doseUnit
 */

/**
 * Inputs of a completed quick-dose calculation, as typed by the user.
 * @typedef {object} QuickInputs
 * @property {string} concentrationMgPerMl
 * @property {string} doseValue
 * @property {DoseField} doseUnit
 */

/**
 * Results of a completed calculation (display strings, PLAN.md §5 `results`).
 * @typedef {object} CalcResults
 * @property {string} concentrationMgPerMl
 * @property {string} drawMl
 * @property {number} syringeUnits
 */

/**
 * A completed calculation, appended to the history log (PLAN.md §5 `history`).
 * @typedef {object} HistoryEntry
 * @property {string} id
 * @property {number} timestamp
 * @property {Mode} mode
 * @property {RecInputs | QuickInputs} inputs
 * @property {CalcResults} results
 */

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
 * @property {() => Omit<RecInputs, 'doseValue' | 'doseUnit'> | Omit<QuickInputs, 'doseValue' | 'doseUnit'>} describeInputs
 * @property {string} volumeHint  Shown when dose mass is known but no concentration.
 * @property {string} massHint  Shown when draw volume is known but no concentration.
 * @property {() => import('../lib/calc.js').UnitsPerMl} getUnitsPerMl
 * @property {(inputs: RecInputs | QuickInputs, results: CalcResults) => void} logComplete
 */

/**
 * The controller other UI modules use to drive the calculator.
 *
 * @typedef {object} CalculatorController
 * @property {(p: { vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }) => void} loadReconstitution
 * @property {(p: { doseAmount: string, doseUnit: DoseField }) => void} loadDoseIntoActive
 * @property {(entry: HistoryEntry) => void} loadHistoryEntry
 * @property {() => { panel: Mode, field: DoseField, value: string }} getActiveDoseSource
 * @property {() => Mode} getActivePanel
 * @property {() => { vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }} getReconstitutionInputs
 * @property {() => import('../lib/calc.js').UnitsPerMl} getUnitsPerMl
 * @property {(unitsPerMl: import('../lib/calc.js').UnitsPerMl) => void} setUnitsPerMl
 * @property {(cb: (entry: HistoryEntry) => void) => () => void} onCalculationComplete
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
// Mode tabs
// ---------------------------------------------------------------------------

/**
 * Wire up the mode tabs (click + arrow-key navigation).
 *
 * @param {(panel: Mode) => void} onSelect  Notified on user-initiated switches.
 * @returns {{ selectPanel(panel: Mode): void }}
 */
function initModeTabs(onSelect) {
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

  /** @type {(i: number) => void} */
  const userSelect = (i) => {
    select(i);
    onSelect(i === 0 ? 'reconstitution' : 'quick-dose');
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => userSelect(i));
    tab.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length
        : null;
      if (next === null) return;
      tabs[next]?.focus();
      userSelect(next);
      event.preventDefault();
    });
  });

  return {
    /**
     * @param {Mode} panel
     * @returns {void}
     */
    selectPanel(panel) {
      select(panel === 'reconstitution' ? 0 : 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Dose group (shared by both modes)
// ---------------------------------------------------------------------------

/**
 * Wire one dose group: four bidirectional fields (mg / mcg / mL / units),
 * result readouts, warnings, and completed-calculation logging. The field
 * being edited is the source of truth; every other field is derived live.
 *
 * @param {DoseGroupConfig} config
 * @returns {{ refresh(): void, setDose(field: DoseField, raw: string): void, clearDose(): void, getDoseSource(): { field: DoseField, value: string }, flush(): void }}
 */
function setupDoseGroup(config) {
  /** @type {DoseField} */
  let source = 'mg';

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let logTimer;
  /** @type {(() => void) | null} */
  let pendingLog = null;
  /** @type {string | null} */
  let pendingKey = null;
  /** @type {string | null} */
  let lastLoggedKey = null;

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
          const fromUnits = unitsToMicroliters(raw, config.getUnitsPerMl());
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
      const unitsOut = microlitersToUnits(drawUl, config.getUnitsPerMl());
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

    scheduleLog(ctx, raw, doseUg, drawUl);
  }

  /**
   * Log the calculation once typing settles on a complete, valid state
   * (concentration + dose + draw volume all present). Deduplicated against
   * the last logged snapshot so re-renders don't spam the history.
   *
   * @param {ConcentrationContext} ctx
   * @param {string} raw  Source field value as typed.
   * @param {import('../lib/calc.js').Micrograms | null} doseUg
   * @param {import('../lib/calc.js').Microliters | null} drawUl
   * @returns {void}
   */
  function scheduleLog(ctx, raw, doseUg, drawUl) {
    cancelPendingLog();
    const complete = doseUg !== null && drawUl !== null && ctx.concentration !== null;
    if (!complete || raw === '') return;

    const unitsPerMl = config.getUnitsPerMl();
    const inputs = /** @type {RecInputs | QuickInputs} */ ({
      ...config.describeInputs(),
      doseValue: raw,
      doseUnit: source,
    });
    const results = /** @type {CalcResults} */ ({
      concentrationMgPerMl: ctx.concentration ? concentrationMgPerMl(ctx.concentration) : '',
      drawMl: microlitersToMlString(/** @type {import('../lib/calc.js').Microliters} */ (drawUl)),
      syringeUnits: microlitersToUnits(/** @type {import('../lib/calc.js').Microliters} */ (drawUl), unitsPerMl).value,
    });
    // Include the syringe calibration: same inputs, different units result.
    const key = JSON.stringify({ unitsPerMl, inputs });
    if (key === lastLoggedKey) return;

    pendingKey = key;
    pendingLog = () => config.logComplete(inputs, results);
    logTimer = setTimeout(firePendingLog, LOG_DEBOUNCE_MS);
  }

  function cancelPendingLog() {
    if (logTimer !== undefined) {
      clearTimeout(logTimer);
      logTimer = undefined;
    }
    pendingLog = null;
    pendingKey = null;
  }

  function firePendingLog() {
    logTimer = undefined;
    const log = pendingLog;
    const key = pendingKey;
    pendingLog = null;
    pendingKey = null;
    if (log && key !== null && key !== lastLoggedKey) {
      lastLoggedKey = key;
      log();
    }
  }

  // Initial state: results blank, warnings hidden.
  update();

  return {
    refresh: update,
    /**
     * Programmatically set the source dose field (e.g. from a preset).
     *
     * @param {DoseField} field
     * @param {string} raw
     * @returns {void}
     */
    setDose(field, raw) {
      if (!FIELDS.includes(field)) return;
      source = field;
      config.dose[field].value = raw;
      update();
    },
    /**
     * Clear all dose fields (e.g. when a vial preset is loaded).
     *
     * @returns {void}
     */
    clearDose() {
      for (const field of FIELDS) {
        config.dose[field].value = '';
        setApprox(approxEls[field], false);
      }
      source = 'mg';
      update();
    },
    /**
     * @returns {{ field: DoseField, value: string }}
     */
    getDoseSource() {
      return { field: source, value: config.dose[source].value };
    },
    /** Immediately log a pending completed calculation (page unload). */
    flush() {
      if (logTimer !== undefined) {
        clearTimeout(logTimer);
        logTimer = undefined;
      }
      if (pendingLog) firePendingLog();
    },
  };
}

// ---------------------------------------------------------------------------
// Reconstitution mode
// ---------------------------------------------------------------------------

/**
 * Reconstitution mode: vial amount + diluent → concentration, then dose.
 *
 * @param {{ getUnitsPerMl(): import('../lib/calc.js').UnitsPerMl, logCalculation(detail: { mode: Mode, inputs: RecInputs | QuickInputs, results: CalcResults }): void }} deps
 * @returns {{ setInputs(p: { vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }): void, getInputs(): { vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }, doseGroup: ReturnType<setupDoseGroup> }}
 */
function initReconstitutionPanel(deps) {
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
    describeInputs: () => ({
      vialAmount: vialInput.value.trim(),
      vialUnit: /** @type {'mg' | 'mcg'} */ (vialUnit.value),
      diluentMl: diluentInput.value.trim(),
    }),
    getUnitsPerMl: deps.getUnitsPerMl,
    volumeHint: HINT,
    massHint: HINT,
    logComplete: (inputs, results) => {
      deps.logCalculation({ mode: 'reconstitution', inputs, results });
    },
  });

  for (const el of [vialInput, diluentInput]) {
    el.addEventListener('input', () => doseGroup.refresh());
  }
  vialUnit.addEventListener('change', () => doseGroup.refresh());

  return {
    /**
     * Load a vial + diluent (e.g. from a preset); dose section cleared.
     *
     * @param {{ vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }} p
     * @returns {void}
     */
    setInputs({ vialAmount, vialUnit: unit, diluentMl }) {
      vialInput.value = vialAmount;
      vialUnit.value = unit;
      diluentInput.value = diluentMl;
      doseGroup.clearDose();
    },
    /**
     * @returns {{ vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }}
     */
    getInputs() {
      return {
        vialAmount: vialInput.value.trim(),
        vialUnit: /** @type {'mg' | 'mcg'} */ (vialUnit.value),
        diluentMl: diluentInput.value.trim(),
      };
    },
    doseGroup,
  };
}

// ---------------------------------------------------------------------------
// Quick dose mode
// ---------------------------------------------------------------------------

/**
 * Quick dose mode: known concentration → dose volume.
 *
 * @param {{ getUnitsPerMl(): import('../lib/calc.js').UnitsPerMl, logCalculation(detail: { mode: Mode, inputs: RecInputs | QuickInputs, results: CalcResults }): void }} deps
 * @returns {{ setConcentration(raw: string): void, doseGroup: ReturnType<setupDoseGroup> }}
 */
function initQuickDosePanel(deps) {
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
    describeInputs: () => ({
      concentrationMgPerMl: concInput.value.trim(),
    }),
    getUnitsPerMl: deps.getUnitsPerMl,
    volumeHint: HINT,
    massHint: HINT,
    logComplete: (inputs, results) => {
      deps.logCalculation({ mode: 'quick-dose', inputs, results });
    },
  });

  concInput.addEventListener('input', () => doseGroup.refresh());

  return {
    /**
     * @param {string} raw
     * @returns {void}
     */
    setConcentration(raw) {
      concInput.value = raw;
      doseGroup.clearDose();
    },
    doseGroup,
  };
}

// ---------------------------------------------------------------------------
// Entry point + controller
// ---------------------------------------------------------------------------

/**
 * Initialise the whole calculator (tabs, both modes, logging) and return the
 * controller used by the presets / history / settings modules.
 *
 * @returns {CalculatorController}
 */
export function initCalculator() {
  /** @type {Set<(entry: HistoryEntry) => void>} */
  const subscribers = new Set();
  /** @type {Mode} */
  let activePanel = 'reconstitution';
  let unitsPerMl = parseUnitsPerMl(String(loadSettings(localStorage).unitsPerMl));

  const tabs = initModeTabs((panel) => {
    activePanel = panel;
  });

  /**
   * Fan a completed calculation out to subscribers (history).
   *
   * @param {{ mode: Mode, inputs: RecInputs | QuickInputs, results: CalcResults }} detail
   * @returns {void}
   */
  function logCalculation(detail) {
    /** @type {HistoryEntry} */
    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      mode: detail.mode,
      inputs: detail.inputs,
      results: detail.results,
    };
    for (const cb of subscribers) cb(entry);
  }

  const rec = initReconstitutionPanel({ getUnitsPerMl: () => unitsPerMl, logCalculation });
  const quick = initQuickDosePanel({ getUnitsPerMl: () => unitsPerMl, logCalculation });

  // The panel the user last touched is where dose presets save from / load to.
  for (const [panelId, panelEl] of /** @type {[Mode, HTMLElement][]} */ ([
    ['reconstitution', byId('panel-reconstitution')],
    ['quick-dose', byId('panel-quickdose')],
  ])) {
    panelEl.addEventListener('input', () => {
      activePanel = panelId;
    }, true);
  }

  // Flush pending completed calculations when the page goes away.
  window.addEventListener('pagehide', () => {
    rec.doseGroup.flush();
    quick.doseGroup.flush();
  });

  return {
    /**
     * @param {{ vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }} preset
     * @returns {void}
     */
    loadReconstitution(preset) {
      tabs.selectPanel('reconstitution');
      activePanel = 'reconstitution';
      rec.setInputs(preset);
    },
    /**
     * Load a dose into whichever panel is active.
     *
     * @param {{ doseAmount: string, doseUnit: DoseField }} p
     * @returns {void}
     */
    loadDoseIntoActive({ doseAmount, doseUnit }) {
      (activePanel === 'quick-dose' ? quick : rec).doseGroup.setDose(doseUnit, doseAmount);
    },
    /**
     * @param {HistoryEntry} entry
     * @returns {void}
     */
    loadHistoryEntry(entry) {
      const inputs = entry.inputs;
      if ('concentrationMgPerMl' in inputs) {
        tabs.selectPanel('quick-dose');
        activePanel = 'quick-dose';
        quick.setConcentration(inputs.concentrationMgPerMl);
        quick.doseGroup.setDose(inputs.doseUnit, inputs.doseValue);
      } else {
        tabs.selectPanel('reconstitution');
        activePanel = 'reconstitution';
        rec.setInputs({
          vialAmount: inputs.vialAmount,
          vialUnit: inputs.vialUnit,
          diluentMl: inputs.diluentMl,
        });
        rec.doseGroup.setDose(inputs.doseUnit, inputs.doseValue);
      }
    },
    /**
     * @returns {{ panel: Mode, field: DoseField, value: string }}
     */
    getActiveDoseSource() {
      const group = activePanel === 'quick-dose' ? quick.doseGroup : rec.doseGroup;
      return { panel: activePanel, ...group.getDoseSource() };
    },
    /**
     * @returns {Mode}
     */
    getActivePanel() {
      return activePanel;
    },
    /**
     * @returns {{ vialAmount: string, vialUnit: 'mg' | 'mcg', diluentMl: string }}
     */
    getReconstitutionInputs() {
      return rec.getInputs();
    },
    /**
     * @returns {import('../lib/calc.js').UnitsPerMl}
     */
    getUnitsPerMl() {
      return unitsPerMl;
    },
    /**
     * @param {import('../lib/calc.js').UnitsPerMl} value
     * @returns {void}
     */
    setUnitsPerMl(value) {
      unitsPerMl = value;
      rec.doseGroup.refresh();
      quick.doseGroup.refresh();
    },
    /**
     * @param {(entry: HistoryEntry) => void} cb
     * @returns {() => void} Unsubscribe.
     */
    onCalculationComplete(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
