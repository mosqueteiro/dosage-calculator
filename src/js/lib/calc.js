/**
 * Pure dosage-calculation math. No DOM access, no I/O — safe to unit-test
 * exhaustively with `node --test`.
 *
 * Correctness rules (PLAN.md §4 — single source of truth):
 *
 * - **Fixed-point integers only.** Mass is stored in micrograms (µg), volume
 *   in microliters (µL). Identity: `1 mg/mL === 1 µg/µL`, so concentration
 *   stays integer-friendly. Realistic values (≤ ~100 mg = 100,000,000 µg) are
 *   far below `Number.MAX_SAFE_INTEGER`, so plain integers suffice.
 * - **Decimal parsing is string-based.** User input `"0.25"` is split on the
 *   decimal point and shifted with integer arithmetic on digit strings.
 *   Never `Number(input) * 1000` (which is lossy: `0.1 * 1000 ===
 *   100.00000000000001`).
 * - **Division rounds once, half up.** Division is the only non-integer
 *   operation. Results are rounded to the nearest µL (or µg / whole syringe
 *   unit, depending on the target) and never re-rounded. Rounded results are
 *   flagged so the UI can mark them with `≈`.
 * - **Concentration is kept as a ratio** (`massUg / volumeUl`) so intermediate
 *   values never need rounding, even for concentrations that are not neat
 *   decimals (e.g. 250 µg in 300 µL).
 *
 * Units mix-up is a compile-time error: every value carries a JSDoc branded
 * type (`Micrograms`, `Microliters`, …), checked by `tsc --noEmit --checkJs`.
 */

/**
 * Branded integer: mass in micrograms (µg).
 * @typedef {number & { __brand: 'Micrograms' }} Micrograms
 */

/**
 * Branded integer: volume in microliters (µL).
 * @typedef {number & { __brand: 'Microliters' }} Microliters
 */

/**
 * Branded integer: whole syringe units.
 * @typedef {number & { __brand: 'SyringeUnits' }} SyringeUnits
 */

/**
 * Branded integer: syringe calibration, units per mL (100 for U-100).
 * @typedef {number & { __brand: 'UnitsPerMl' }} UnitsPerMl
 */

/**
 * Branded string: a mass formatted in mg (display / input echo).
 * @typedef {string & { __brand: 'Mg' }} Mg
 */

/**
 * Branded string: a mass formatted in mcg (display / input echo).
 * @typedef {string & { __brand: 'Mcg' }} Mcg
 */

/**
 * Branded string: a volume formatted in mL (display / input echo).
 * @typedef {string & { __brand: 'Ml' }} Ml
 */

/**
 * A concentration as an exact integer ratio: `massUg / volumeUl` in µg/µL,
 * numerically identical to mg/mL.
 *
 * @typedef {object} Concentration
 * @property {Micrograms} massUg  Mass of vial contents, µg. Always ≥ 1.
 * @property {Microliters} volumeUl  Diluent volume, µL. Always ≥ 1.
 */

/**
 * A computed quantity together with whether division had to round.
 * When `rounded` is true the UI should display the value with a `≈` marker.
 *
 * @template T
 * @typedef {object} Quantified
 * @property {T} value  The (possibly rounded) value.
 * @property {boolean} rounded  True if the exact result was not an integer.
 */

/** Machine-readable error codes for {@link CalcError#code}. */
export const CalcErrorCode = {
  /** Input is empty or not a plain decimal number. */
  INVALID: 'invalid',
  /** Input is negative (never legal here). */
  NEGATIVE: 'negative',
  /** Input has more fractional precision than the internal unit allows. */
  PRECISION: 'precision',
  /** Input is a valid number but exceeds the safe integer range. */
  RANGE: 'range',
  /** Diluent volume is zero — concentration is undefined. */
  ZERO_DILUENT: 'zero-diluent',
  /** Vial amount is zero — concentration is zero, draw volume undefined. */
  ZERO_VIAL: 'zero-vial',
  /** Units-per-mL is zero — syringe units are undefined. */
  ZERO_UNITS_PER_ML: 'zero-units-per-ml',
  /** Unknown mass unit string. */
  UNKNOWN_UNIT: 'unknown-unit',
  /** Internal invariant violated (a bug, not bad user input). */
  INTERNAL: 'internal',
};

/** Error thrown for invalid or physically impossible calculation inputs. */
export class CalcError extends Error {
  /**
   * @param {string} code  One of the {@link CalcErrorCode} values.
   * @param {string} message  Human-readable explanation.
   */
  constructor(code, message) {
    super(message);
    this.name = 'CalcError';
    /** @type {string} */
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Branded-type casts and runtime guards
// ---------------------------------------------------------------------------

/**
 * @param {number} n
 * @returns {Micrograms}
 */
const asUg = (n) => /** @type {Micrograms} */ (/** @type {unknown} */ (n));

/**
 * @param {number} n
 * @returns {Microliters}
 */
const asUl = (n) => /** @type {Microliters} */ (/** @type {unknown} */ (n));

/**
 * @param {number} n
 * @returns {SyringeUnits}
 */
const asUnits = (n) => /** @type {SyringeUnits} */ (/** @type {unknown} */ (n));

/**
 * @param {number} n
 * @returns {UnitsPerMl}
 */
const asUnitsPerMl = (n) =>
  /** @type {UnitsPerMl} */ (/** @type {unknown} */ (n));

/**
 * @param {string} s
 * @returns {Mg}
 */
const asMg = (s) => /** @type {Mg} */ (/** @type {unknown} */ (s));

/**
 * @param {string} s
 * @returns {Mcg}
 */
const asMcg = (s) => /** @type {Mcg} */ (/** @type {unknown} */ (s));

/**
 * @param {string} s
 * @returns {Ml}
 */
const asMl = (s) => /** @type {Ml} */ (/** @type {unknown} */ (s));

/**
 * Runtime belt-and-braces for values that cross a trust boundary (e.g. read
 * back from localStorage). The branded types are the compile-time layer.
 *
 * @param {number} n
 * @param {string} what  Description used in error messages.
 * @returns {number}
 */
function assertNonNegativeSafeInt(n, what) {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new CalcError(CalcErrorCode.INTERNAL, `${what} is not a non-negative safe integer`);
  }
  return n;
}

/**
 * @param {Concentration} c
 * @returns {Concentration}
 */
function assertConcentration(c) {
  if (typeof c !== 'object' || c === null) {
    throw new CalcError(CalcErrorCode.INTERNAL, 'concentration is missing');
  }
  assertNonNegativeSafeInt(c.massUg, 'concentration mass');
  assertNonNegativeSafeInt(c.volumeUl, 'concentration volume');
  if (c.massUg === 0) throw new CalcError(CalcErrorCode.ZERO_VIAL, 'Concentration has zero mass');
  if (c.volumeUl === 0) throw new CalcError(CalcErrorCode.ZERO_DILUENT, 'Concentration has zero volume');
  return c;
}

// ---------------------------------------------------------------------------
// String-based decimal parsing
// ---------------------------------------------------------------------------

/** Plain (non-scientific) non-negative decimal: `12`, `12.5`, `.5`, `12.` */
const DECIMAL_RE = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Parse a non-negative decimal string into an integer scaled by 10^scale,
 * using arithmetic on digit strings only — no float ever touches the path.
 *
 * More fractional digits than `scale` are accepted only when the extra digits
 * are all zeros (e.g. `"1.2500"` mg at scale 3). Otherwise a
 * `precision` CalcError is thrown, because the value is finer than the
 * internal unit (1 µg / 1 µL) can represent without lossy rounding.
 *
 * @param {string} input  User-typed decimal. A single comma is accepted as a
 *   decimal separator and surrounding whitespace is trimmed.
 * @param {number} scale  Number of fractional digits allowed at target scale.
 * @param {string} what  Description used in error messages.
 * @returns {number} Plain non-negative safe integer.
 */
function parseScaled(input, scale, what) {
  if (typeof input !== 'string') {
    throw new CalcError(CalcErrorCode.INVALID, `${what} must be text`);
  }
  const s = input.trim().replace(',', '.');
  if (!DECIMAL_RE.test(s)) {
    throw new CalcError(CalcErrorCode.INVALID, `${what} is not a valid number`);
  }

  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  let fracPart = dot === -1 ? '' : s.slice(dot + 1);

  if (fracPart.length > scale) {
    const extra = fracPart.slice(scale);
    if (/[^0]/.test(extra)) {
      const detail =
        scale === 0
          ? `${what} must be a whole number`
          : `${what} has more than ${scale} decimal place${scale === 1 ? '' : 's'}`;
      throw new CalcError(CalcErrorCode.PRECISION, detail);
    }
    fracPart = fracPart.slice(0, scale);
  }
  fracPart = fracPart.padEnd(scale, '0');

  // Strip leading zeros so the digit string is short, then read it as an
  // integer in one lossless step (17+ digits is rejected below, before
  // Number() could silently round).
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '');
  if (digits.length > 15) {
    throw new CalcError(CalcErrorCode.RANGE, `${what} is too large`);
  }
  const value = digits === '' ? 0 : Number(digits);
  if (!Number.isSafeInteger(value)) {
    throw new CalcError(CalcErrorCode.RANGE, `${what} is too large`);
  }
  return value;
}

/**
 * Parse a mass given in milligrams into micrograms (3 fraction digits max,
 * i.e. µg resolution).
 *
 * @param {string} input
 * @returns {Micrograms}
 */
export function parseMassMg(input) {
  return asUg(parseScaled(input, 3, 'mass in mg'));
}

/**
 * Parse a mass given in micrograms into micrograms (whole mcg only).
 *
 * @param {string} input
 * @returns {Micrograms}
 */
export function parseMassMcg(input) {
  return asUg(parseScaled(input, 0, 'mass in mcg'));
}

/**
 * Parse a mass in the given unit (`'mg'` or `'mcg'`) into micrograms.
 *
 * @param {string} input
 * @param {'mg' | 'mcg'} unit
 * @returns {Micrograms}
 */
export function parseMass(input, unit) {
  if (unit === 'mg') return parseMassMg(input);
  if (unit === 'mcg') return parseMassMcg(input);
  throw new CalcError(CalcErrorCode.UNKNOWN_UNIT, `Unknown mass unit: ${String(unit)}`);
}

/**
 * Parse a volume given in millilitres into microlitres (3 fraction digits
 * max, i.e. µL resolution). Also used for dose-in-mL input, which ties
 * directly to the draw volume.
 *
 * @param {string} input
 * @returns {Microliters}
 */
export function parseVolumeMl(input) {
  return asUl(parseScaled(input, 3, 'volume in mL'));
}

/**
 * Parse the syringe calibration (units per mL), e.g. 100 for U-100.
 *
 * @param {string} input
 * @returns {UnitsPerMl}
 */
export function parseUnitsPerMl(input) {
  const value = parseScaled(input, 0, 'units per mL');
  if (value === 0) {
    throw new CalcError(CalcErrorCode.ZERO_UNITS_PER_ML, 'Units per mL must be greater than zero');
  }
  return asUnitsPerMl(value);
}

// ---------------------------------------------------------------------------
// Formatting (internal integers → display strings)
// ---------------------------------------------------------------------------

/**
 * Format an integer scaled by 10^-scale as a decimal string, trimming
 * trailing zeros. Pure string/int arithmetic.
 *
 * @param {number} value  Integer at scale 10^-scale.
 * @param {number} scale
 * @returns {string}
 */
function scaledToString(value, scale) {
  assertNonNegativeSafeInt(value, 'formatted value');
  const digits = String(value).padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale).replace(/0+$/, '');
  return fracPart === '' ? intPart : `${intPart}.${fracPart}`;
}

/**
 * Format micrograms as an mg string (3 fraction digits max, trailing zeros
 * trimmed). Display-only: never feed back into calculations without parsing.
 *
 * @param {Micrograms} ug
 * @returns {Mg}
 */
export function microgramsToMgString(ug) {
  return asMg(scaledToString(assertNonNegativeSafeInt(ug, 'mass'), 3));
}

/**
 * Format micrograms as a whole-mcg string.
 *
 * @param {Micrograms} ug
 * @returns {Mcg}
 */
export function microgramsToMcgString(ug) {
  return asMcg(scaledToString(assertNonNegativeSafeInt(ug, 'mass'), 0));
}

/**
 * Format microlitres as an mL string (3 fraction digits max, trailing zeros
 * trimmed).
 *
 * @param {Microliters} ul
 * @returns {Ml}
 */
export function microlitersToMlString(ul) {
  return asMl(scaledToString(assertNonNegativeSafeInt(ul, 'volume'), 3));
}

// ---------------------------------------------------------------------------
// Core calculations
// ---------------------------------------------------------------------------

/**
 * Integer division rounded half up, for non-negative operands.
 * Returns the quotient and whether the division was exact — `exact === false`
 * means the caller must flag the result as rounded (`≈`).
 *
 * @param {number} a  Non-negative safe integer numerator.
 * @param {number} b  Positive safe integer denominator.
 * @returns {{ q: number, exact: boolean }}
 */
function divHalfUp(a, b) {
  assertNonNegativeSafeInt(a, 'division numerator');
  assertNonNegativeSafeInt(b, 'division denominator');
  if (b === 0) throw new CalcError(CalcErrorCode.INTERNAL, 'division by zero');
  const q = Math.floor(a / b);
  const r = a - q * b;
  return { q: r * 2 >= b ? q + 1 : q, exact: r === 0 };
}

/**
 * Compute the reconstitution concentration from vial amount and diluent
 * volume. The result is an exact ratio — nothing is rounded here.
 *
 * `concentration(mg/mL) = vialAmount(µg) / diluentVolume(µL)`.
 *
 * @param {{ vialUg: Micrograms, diluentUl: Microliters }} params
 * @returns {Concentration}
 */
export function computeConcentration({ vialUg, diluentUl }) {
  assertNonNegativeSafeInt(vialUg, 'vial amount');
  assertNonNegativeSafeInt(diluentUl, 'diluent volume');
  if (diluentUl === 0) {
    throw new CalcError(CalcErrorCode.ZERO_DILUENT, 'Diluent volume must be greater than zero');
  }
  if (vialUg === 0) {
    throw new CalcError(CalcErrorCode.ZERO_VIAL, 'Vial amount must be greater than zero');
  }
  return { massUg: asUg(vialUg), volumeUl: asUl(diluentUl) };
}

/**
 * Draw volume for a dose: `drawVolume(µL) = dose(µg) × concVolume(µL) /
 * concMass(µg)`, rounded once, half up, to the nearest µL. 1 µL = 0.001 mL is
 * ten times finer than a U-100 syringe's 0.01 mL gradation, so a single
 * rounding loses no practical precision.
 *
 * A zero dose is allowed and yields volume 0 (the UI decides whether to warn).
 *
 * @param {{ doseUg: Micrograms, concentration: Concentration }} params
 * @returns {Quantified<Microliters>}
 */
export function computeDrawVolume({ doseUg, concentration }) {
  const { massUg, volumeUl } = assertConcentration(concentration);
  assertNonNegativeSafeInt(doseUg, 'dose');
  const product = doseUg * volumeUl;
  if (!Number.isSafeInteger(product)) {
    throw new CalcError(CalcErrorCode.RANGE, 'Dose is too large for this concentration');
  }
  const { q, exact } = divHalfUp(product, massUg);
  return { value: asUl(q), rounded: !exact };
}

/**
 * Dose contained in a drawn volume:
 * `dose(µg) = drawVolume(µL) × concMass(µg) / concVolume(µL)`, rounded once,
 * half up, to the nearest µg.
 *
 * @param {{ drawUl: Microliters, concentration: Concentration }} params
 * @returns {Quantified<Micrograms>}
 */
export function computeDoseFromVolume({ drawUl, concentration }) {
  const { massUg, volumeUl } = assertConcentration(concentration);
  assertNonNegativeSafeInt(drawUl, 'draw volume');
  const product = drawUl * massUg;
  if (!Number.isSafeInteger(product)) {
    throw new CalcError(CalcErrorCode.RANGE, 'Draw volume is too large for this concentration');
  }
  const { q, exact } = divHalfUp(product, volumeUl);
  return { value: asUg(q), rounded: !exact };
}

// ---------------------------------------------------------------------------
// Syringe units
// ---------------------------------------------------------------------------

/**
 * Convert a drawn volume to whole syringe units:
 * `units = drawVolume(µL) × unitsPerMl / 1000`, rounded once, half up, to the
 * nearest whole unit.
 *
 * @param {Microliters} ul
 * @param {UnitsPerMl} unitsPerMl  e.g. 100 for a U-100 insulin syringe.
 * @returns {Quantified<SyringeUnits>}
 */
export function microlitersToUnits(ul, unitsPerMl) {
  assertNonNegativeSafeInt(ul, 'draw volume');
  assertNonNegativeSafeInt(unitsPerMl, 'units per mL');
  if (unitsPerMl === 0) {
    throw new CalcError(CalcErrorCode.ZERO_UNITS_PER_ML, 'Units per mL must be greater than zero');
  }
  const product = ul * unitsPerMl;
  if (!Number.isSafeInteger(product)) {
    throw new CalcError(CalcErrorCode.RANGE, 'Volume is too large for this syringe');
  }
  const { q, exact } = divHalfUp(product, 1000);
  return { value: asUnits(q), rounded: !exact };
}

/**
 * Convert syringe units to a draw volume:
 * `drawVolume(µL) = units × 1000 / unitsPerMl`, rounded once, half up, to the
 * nearest µL. Units are parsed from a string (up to 2 fraction digits, so
 * half-unit marks like `12.5` work on U-100).
 *
 * @param {string} input  Units as typed, e.g. `"12.5"`.
 * @param {UnitsPerMl} unitsPerMl
 * @returns {Quantified<Microliters>}
 */
export function unitsToMicroliters(input, unitsPerMl) {
  assertNonNegativeSafeInt(unitsPerMl, 'units per mL');
  if (unitsPerMl === 0) {
    throw new CalcError(CalcErrorCode.ZERO_UNITS_PER_ML, 'Units per mL must be greater than zero');
  }
  const unitsInt = parseScaled(input, 2, 'syringe units');
  const { q, exact } = divHalfUp(unitsInt * 1000, unitsPerMl * 100);
  return { value: asUl(q), rounded: !exact };
}

// ---------------------------------------------------------------------------
// Display-only ratio formatting
// ---------------------------------------------------------------------------

/**
 * Format the ratio `num / den` as a decimal string with `decimals` fraction
 * digits (half-up rounded at the last digit, trailing zeros trimmed).
 * Display-only — derived from integer internals, never fed back into
 * calculations.
 *
 * @param {number} num  Non-negative safe integer.
 * @param {number} den  Positive safe integer.
 * @param {number} decimals  0–6.
 * @returns {string}
 */
export function ratioToString(num, den, decimals) {
  assertNonNegativeSafeInt(num, 'ratio numerator');
  assertNonNegativeSafeInt(den, 'ratio denominator');
  if (den === 0) throw new CalcError(CalcErrorCode.INTERNAL, 'ratio by zero');
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new CalcError(CalcErrorCode.INTERNAL, 'decimals out of range');
  }
  const factor = 10 ** decimals;
  const scaled = num * factor;
  if (!Number.isSafeInteger(scaled)) {
    throw new CalcError(CalcErrorCode.RANGE, 'ratio is too large to format');
  }
  const { q } = divHalfUp(scaled, den);
  return scaledToString(q, decimals);
}

/**
 * Concentration for display, in mg/mL (numerically identical to µg/µL).
 *
 * @param {Concentration} concentration
 * @param {number} [decimals]  Defaults to 2.
 * @returns {string}
 */
export function concentrationMgPerMl(concentration, decimals = 2) {
  const { massUg, volumeUl } = assertConcentration(concentration);
  return ratioToString(massUg, volumeUl, decimals);
}

// ---------------------------------------------------------------------------
// Safety-guardrail predicates (UI turns these into inline warnings)
// ---------------------------------------------------------------------------

/**
 * True when the desired dose exceeds the vial's total content.
 *
 * @param {Micrograms} doseUg
 * @param {Micrograms} vialUg
 * @returns {boolean}
 */
export function doseExceedsVial(doseUg, vialUg) {
  assertNonNegativeSafeInt(doseUg, 'dose');
  assertNonNegativeSafeInt(vialUg, 'vial amount');
  return doseUg > vialUg;
}

/**
 * True when the draw volume exceeds the total diluent volume.
 *
 * @param {Microliters} drawUl
 * @param {Microliters} diluentUl
 * @returns {boolean}
 */
export function drawExceedsDiluent(drawUl, diluentUl) {
  assertNonNegativeSafeInt(drawUl, 'draw volume');
  assertNonNegativeSafeInt(diluentUl, 'diluent volume');
  return drawUl > diluentUl;
}
