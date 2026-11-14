/**
 * Exhaustive unit tests for the pure calc module (PLAN.md §4).
 *
 * Includes fixed-point arithmetic guarantees and regression tests for the
 * classic float traps (`0.1 + 0.2`, `0.1 * 1000`, `1/3`-style division).
 *
 * Run with: `npm test` (→ `node --test test/`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  parseMass,
  parseMassMcg,
  parseMassMg,
  parseUnitsPerMl,
  parseVolumeMl,
  ratioToString,
  unitsToMicroliters,
} from '../src/js/lib/calc.js';

/**
 * Genuine IEEE-754 traps (verified in this JS engine):
 * - `0.1 + 0.2 === 0.30000000000000004`
 * - `0.3 / 0.1 === 2.9999999999999996`
 * (`0.1 * 1000 === 100` happens to round exactly, so it is NOT a trap —
 * the string parser guarantees exactness regardless.)
 */
const FLOAT_SUM = 0.1 + 0.2; // 0.30000000000000004
const FLOAT_QUOTIENT = 0.3 / 0.1; // 2.9999999999999996

/**
 * Assert the block throws a CalcError with the expected code.
 *
 * @param {string} code
 * @param {() => unknown} fn
 * @returns {void}
 */
function assertCalcThrows(code, fn) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof CalcError, `expected CalcError, got ${err}`);
    assert.equal(
      /** @type {CalcError} */ (err).code,
      code,
      `expected code ${code}, got ${/** @type {CalcError} */ (err).code}`,
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Test-only branded-type casts (plain test literals → internal unit types)
// ---------------------------------------------------------------------------

/**
 * @param {number} n
 * @returns {import('../src/js/lib/calc.js').Micrograms}
 */
const ug = (n) =>
  /** @type {import('../src/js/lib/calc.js').Micrograms} */ (/** @type {unknown} */ (n));

/**
 * @param {number} n
 * @returns {import('../src/js/lib/calc.js').Microliters}
 */
const ul = (n) =>
  /** @type {import('../src/js/lib/calc.js').Microliters} */ (/** @type {unknown} */ (n));

/**
 * @param {number} n
 * @returns {import('../src/js/lib/calc.js').UnitsPerMl}
 */
const upm = (n) =>
  /** @type {import('../src/js/lib/calc.js').UnitsPerMl} */ (/** @type {unknown} */ (n));

// ---------------------------------------------------------------------------
// parseMassMg — string-based decimal parsing (mg → µg)
// ---------------------------------------------------------------------------

test('parseMassMg: basic values', () => {
  assert.equal(parseMassMg('0.25'), 250);
  assert.equal(parseMassMg('1'), 1000);
  assert.equal(parseMassMg('2.5'), 2500);
  assert.equal(parseMassMg('0.001'), 1);
  assert.equal(parseMassMg('12.345'), 12345);
  assert.equal(parseMassMg('5'), 5000);
  assert.equal(parseMassMg('0'), 0);
  assert.equal(parseMassMg('0.0'), 0);
  assert.equal(parseMassMg('007'), 7000); // leading zeros are fine
});

test('parseMassMg: bare and trailing decimal point', () => {
  assert.equal(parseMassMg('.5'), 500);
  assert.equal(parseMassMg('5.'), 5000);
  assert.equal(parseMassMg('.001'), 1);
});

test('parseMassMg: whitespace and comma decimal separator', () => {
  assert.equal(parseMassMg(' 1 '), 1000);
  assert.equal(parseMassMg('1,5'), 1500);
  assert.equal(parseMassMg('  0.25  '), 250);
});

test('parseMassMg: "0.1" mg is exactly 100 µg (string parse, no float path)', () => {
  assert.equal(parseMassMg('0.1'), 100);
});

test('parseMassMg: 0.1 mg + 0.2 mg is exactly 300 µg (0.1+0.2 float regression)', () => {
  // Float path: (0.1 + 0.2) * 1e6 would be 300000.00000000006 µg.
  assert.notEqual(FLOAT_SUM, 0.3);
  const ugA = parseMassMg('0.1');
  const ugB = parseMassMg('0.2');
  assert.equal(ugA + ugB, 300); // exact integer sum
});

test('parseMassMg: trailing zeros beyond µg precision are tolerated', () => {
  assert.equal(parseMassMg('1.2500'), 1250);
  assert.equal(parseMassMg('0.2500000'), 250);
  assert.equal(parseMassMg('1.0000000'), 1000);
  // 0.2505000 mg = 250.5 µg — not representable in integer µg, so rejected.
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseMassMg('0.2505000'));
});

test('parseMassMg: rejects empty and non-numeric input', () => {
  for (const bad of ['', '   ', 'abc', '1e3', '1.2.3', 'NaN', 'Infinity', '--1', '.']) {
    assertCalcThrows(CalcErrorCode.INVALID, () => parseMassMg(bad));
  }
});

test('parseMassMg: rejects negative and signed input', () => {
  assertCalcThrows(CalcErrorCode.INVALID, () => parseMassMg('-1'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseMassMg('+1'));
});

test('parseMassMg: rejects sub-µg precision (0.0001 mg = 0.1 µg)', () => {
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseMassMg('0.2505'));
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseMassMg('0.0001'));
});

test('parseMassMg: rejects values beyond the safe integer range', () => {
  assertCalcThrows(CalcErrorCode.RANGE, () => parseMassMg('99999999999999')); // 1e17 µg
  assertCalcThrows(CalcErrorCode.RANGE, () => parseMassMg('10000000000000000'));
});

// ---------------------------------------------------------------------------
// parseMassMcg — whole micrograms only
// ---------------------------------------------------------------------------

test('parseMassMcg: whole micrograms', () => {
  assert.equal(parseMassMcg('250'), 250);
  assert.equal(parseMassMcg('0'), 0);
  assert.equal(parseMassMcg('100000'), 100000);
});

test('parseMassMcg: trailing ".0" is tolerated', () => {
  assert.equal(parseMassMcg('250.0'), 250);
  assert.equal(parseMassMcg('250.'), 250);
});

test('parseMassMcg: rejects fractional mcg', () => {
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseMassMcg('250.5'));
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseMassMcg('0.1'));
});

test('parseMassMcg: rejects junk', () => {
  assertCalcThrows(CalcErrorCode.INVALID, () => parseMassMcg('abc'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseMassMcg('-5'));
});

// ---------------------------------------------------------------------------
// parseMass — unit dispatch
// ---------------------------------------------------------------------------

test('parseMass: dispatches to mg and mcg parsers', () => {
  assert.equal(parseMass('0.25', 'mg'), 250);
  assert.equal(parseMass('250', 'mcg'), 250);
});

test('parseMass: rejects unknown units', () => {
  // @ts-expect-error deliberately bad unit
  assertCalcThrows(CalcErrorCode.UNKNOWN_UNIT, () => parseMass('1', 'iu'));
  // @ts-expect-error deliberately bad unit
  assertCalcThrows(CalcErrorCode.UNKNOWN_UNIT, () => parseMass('1', ''));
});

// ---------------------------------------------------------------------------
// parseVolumeMl — string-based decimal parsing (mL → µL)
// ---------------------------------------------------------------------------

test('parseVolumeMl: basic values', () => {
  assert.equal(parseVolumeMl('0.5'), 500);
  assert.equal(parseVolumeMl('0.05'), 50);
  assert.equal(parseVolumeMl('1'), 1000);
  assert.equal(parseVolumeMl('2'), 2000);
  assert.equal(parseVolumeMl('10'), 10000);
  assert.equal(parseVolumeMl('1.5'), 1500);
  assert.equal(parseVolumeMl('0.001'), 1);
  assert.equal(parseVolumeMl('2.5'), 2500);
});

test('parseVolumeMl: "0.1" mL is exactly 100 µL (string parse, no float path)', () => {
  assert.equal(parseVolumeMl('0.1'), 100);
});

test('parseVolumeMl: 0.1 mL + 0.2 mL is exactly 300 µL (0.1+0.2 float regression)', () => {
  const ulA = parseVolumeMl('0.1');
  const ulB = parseVolumeMl('0.2');
  assert.equal(ulA + ulB, 300); // exact integer sum, no 300.00000000000006
});

test('parseVolumeMl: rejects sub-µL precision', () => {
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseVolumeMl('0.0005'));
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseVolumeMl('0.1234'));
});

test('parseVolumeMl: rejects empty, junk, and negative input', () => {
  assertCalcThrows(CalcErrorCode.INVALID, () => parseVolumeMl(''));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseVolumeMl('abc'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseVolumeMl('-0.5'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseVolumeMl('1e-3'));
});

test('parseVolumeMl: accepts trailing zeros beyond µL precision', () => {
  assert.equal(parseVolumeMl('0.5000'), 500);
  assert.equal(parseVolumeMl('1.0000'), 1000);
});

// ---------------------------------------------------------------------------
// parseUnitsPerMl
// ---------------------------------------------------------------------------

test('parseUnitsPerMl: whole values', () => {
  assert.equal(parseUnitsPerMl('100'), 100);
  assert.equal(parseUnitsPerMl('40'), 40);
  assert.equal(parseUnitsPerMl('50'), 50);
});

test('parseUnitsPerMl: rejects zero, junk, and fractional values', () => {
  assertCalcThrows(CalcErrorCode.ZERO_UNITS_PER_ML, () => parseUnitsPerMl('0'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseUnitsPerMl('abc'));
  assertCalcThrows(CalcErrorCode.INVALID, () => parseUnitsPerMl('-5'));
  assertCalcThrows(CalcErrorCode.PRECISION, () => parseUnitsPerMl('100.5'));
});

// ---------------------------------------------------------------------------
// Formatting: internal integers → display strings
// ---------------------------------------------------------------------------

test('microgramsToMgString: trims trailing zeros', () => {
  assert.equal(microgramsToMgString(ug(250)), '0.25');
  assert.equal(microgramsToMgString(ug(1000)), '1');
  assert.equal(microgramsToMgString(ug(1500)), '1.5');
  assert.equal(microgramsToMgString(ug(1234)), '1.234');
  assert.equal(microgramsToMgString(ug(100)), '0.1');
  assert.equal(microgramsToMgString(ug(1)), '0.001');
  assert.equal(microgramsToMgString(ug(0)), '0');
  assert.equal(microgramsToMgString(ug(100000)), '100'); // 100 mg
  assert.equal(microgramsToMgString(ug(100000000)), '100000'); // 100,000 mg
});

test('microgramsToMcgString: whole micrograms', () => {
  assert.equal(microgramsToMcgString(ug(250)), '250');
  assert.equal(microgramsToMcgString(ug(0)), '0');
  assert.equal(microgramsToMcgString(ug(1234567)), '1234567');
});

test('microlitersToMlString: trims trailing zeros', () => {
  assert.equal(microlitersToMlString(ul(50)), '0.05');
  assert.equal(microlitersToMlString(ul(1000)), '1');
  assert.equal(microlitersToMlString(ul(1500)), '1.5');
  assert.equal(microlitersToMlString(ul(1234)), '1.234');
  assert.equal(microlitersToMlString(ul(1)), '0.001');
  assert.equal(microlitersToMlString(ul(0)), '0');
});

test('format ↔ parse round-trips are lossless within µg/µL resolution', () => {
  for (const ugValue of [1, 7, 100, 250, 999, 1234, 10000, 100000000]) {
    assert.equal(parseMassMg(microgramsToMgString(ug(ugValue))), ugValue);
    assert.equal(parseMassMcg(microgramsToMcgString(ug(ugValue))), ugValue);
  }
  for (const ulValue of [1, 33, 50, 100, 555, 1000, 12345]) {
    assert.equal(parseVolumeMl(microlitersToMlString(ul(ulValue))), ulValue);
  }
});

// ---------------------------------------------------------------------------
// computeConcentration
// ---------------------------------------------------------------------------

test('computeConcentration: exact integer ratio, nothing rounded', () => {
  assert.deepEqual(computeConcentration({ vialUg: ug(5000), diluentUl: ul(2000) }), {
    massUg: 5000,
    volumeUl: 2000,
  });
});

test('computeConcentration: 5 mg in 0.5 mL is legal (10 mg/mL)', () => {
  const conc = computeConcentration({ vialUg: ug(5000), diluentUl: ul(500) });
  assert.equal(concentrationMgPerMl(conc), '10');
});

test('computeConcentration: displays as mg/mL with half-up rounding', () => {
  // 250 µg in 300 µL = 0.8333… mg/mL
  const conc = computeConcentration({ vialUg: ug(250), diluentUl: ul(300) });
  assert.equal(concentrationMgPerMl(conc, 2), '0.83');
  assert.equal(concentrationMgPerMl(conc, 3), '0.833');
});

test('computeConcentration: zero diluent is an error, not division by zero', () => {
  assertCalcThrows(CalcErrorCode.ZERO_DILUENT, () => computeConcentration({ vialUg: ug(5000), diluentUl: ul(0) }));
});

test('computeConcentration: zero vial is an error', () => {
  assertCalcThrows(CalcErrorCode.ZERO_VIAL, () => computeConcentration({ vialUg: ug(0), diluentUl: ul(2000) }));
});

test('computeConcentration: rejects garbage at runtime (localStorage trust boundary)', () => {
  for (const bad of [-1, 1.5, NaN, '5', null, undefined]) {
    assertCalcThrows(CalcErrorCode.INTERNAL, () =>
      computeConcentration({ vialUg: /** @type {any} */ (bad), diluentUl: ul(1000) }));
  }
});

// ---------------------------------------------------------------------------
// computeDrawVolume — dose / concentration, rounded once, half up
// ---------------------------------------------------------------------------

test('computeDrawVolume: exact case (0.25 mg at 0.25 mg/mL → 1 mL)', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(4000) });
  const result = computeDrawVolume({ doseUg: ug(250), concentration: conc });
  assert.equal(result.value, 1000);
  assert.equal(result.rounded, false);
});

test('computeDrawVolume: float-drift regression — 0.3 mg at 0.1 mg/mL is exactly 3 mL', () => {
  // Float path: 0.3 / 0.1 === 2.9999999999999996 → 2999 µL. Integer path: 3000.
  assert.notEqual(FLOAT_QUOTIENT, 3);
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(10000) });
  const result = computeDrawVolume({ doseUg: ug(300), concentration: conc });
  assert.equal(result.value, 3000);
  assert.equal(result.rounded, false);
});

test('computeDrawVolume: rounds half up to the nearest µL', () => {
  const conc = computeConcentration({ vialUg: ug(3000), diluentUl: ul(1000) }); // 3 µg/µL
  // 10 µg / 3 µg/µL = 3.333… → 3
  assert.deepEqual(computeDrawVolume({ doseUg: ug(10), concentration: conc }), { value: 3, rounded: true });
  // 15 µg / 3 = 5 exactly
  assert.deepEqual(computeDrawVolume({ doseUg: ug(15), concentration: conc }), { value: 5, rounded: false });
});

test("computeDrawVolume: exact .5 rounds up (half up, not banker's rounding)", () => {
  const conc = computeConcentration({ vialUg: ug(2), diluentUl: ul(1) }); // 2 µg/µL
  assert.deepEqual(computeDrawVolume({ doseUg: ug(5), concentration: conc }), { value: 3, rounded: true }); // 2.5 → 3
  assert.deepEqual(computeDrawVolume({ doseUg: ug(15), concentration: conc }), { value: 8, rounded: true }); // 7.5 → 8
  assert.deepEqual(computeDrawVolume({ doseUg: ug(25), concentration: conc }), { value: 13, rounded: true }); // 12.5 → 13
});

test('computeDrawVolume: rounding happens once and is never re-rounded', () => {
  const conc = computeConcentration({ vialUg: ug(3000), diluentUl: ul(1000) }); // 3 µg/µL
  const draw = computeDrawVolume({ doseUg: ug(10), concentration: conc }); // 10/3 → 3 µL
  assert.equal(draw.value, 3);
  // Re-deriving the dose from the rounded volume is a fresh calculation:
  // 3 µL × 3 µg/µL = 9 µg exactly — no accumulated drift.
  const dose = computeDoseFromVolume({ drawUl: draw.value, concentration: conc });
  assert.deepEqual(dose, { value: 9, rounded: false });
});

test('computeDrawVolume: zero dose yields zero volume', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(4000) });
  assert.deepEqual(computeDrawVolume({ doseUg: ug(0), concentration: conc }), { value: 0, rounded: false });
});

test('computeDrawVolume: dose exceeding vial content still computes (warnings are non-blocking)', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(4000) });
  const result = computeDrawVolume({ doseUg: ug(2000), concentration: conc });
  assert.equal(result.value, 8000); // 8 mL — UI warns, number still shown
});

// ---------------------------------------------------------------------------
// computeDoseFromVolume — draw volume × concentration
// ---------------------------------------------------------------------------

test('computeDoseFromVolume: exact case (0.5 mL at 0.25 mg/mL → 0.125 mg)', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(4000) });
  assert.deepEqual(computeDoseFromVolume({ drawUl: ul(500), concentration: conc }), { value: 125, rounded: false });
});

test('computeDoseFromVolume: float-drift regression — 1 mL at 0.1 mg/mL is exactly 0.1 mg', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(10000) });
  assert.deepEqual(computeDoseFromVolume({ drawUl: ul(1000), concentration: conc }), { value: 100, rounded: false });
});

test('computeDoseFromVolume: rounds half up to the nearest µg', () => {
  // 5 µL × 1000 µg / 3000 µL = 1.666… µg → 2
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(3000) });
  assert.deepEqual(computeDoseFromVolume({ drawUl: ul(5), concentration: conc }), { value: 2, rounded: true });
  // 1 µL × 3 µg / 2 µL = 1.5 µg → 2 (half up)
  const halb = computeConcentration({ vialUg: ug(3), diluentUl: ul(2) });
  assert.deepEqual(computeDoseFromVolume({ drawUl: ul(1), concentration: halb }), { value: 2, rounded: true });
});

test('computeDoseFromVolume: zero draw yields zero dose', () => {
  const conc = computeConcentration({ vialUg: ug(1000), diluentUl: ul(4000) });
  assert.deepEqual(computeDoseFromVolume({ drawUl: ul(0), concentration: conc }), { value: 0, rounded: false });
});

// ---------------------------------------------------------------------------
// Syringe units
// ---------------------------------------------------------------------------

test('microlitersToUnits: U-100 conversions', () => {
  assert.deepEqual(microlitersToUnits(ul(100), upm(100)), { value: 10, rounded: false });
  assert.deepEqual(microlitersToUnits(ul(50), upm(100)), { value: 5, rounded: false });
  assert.deepEqual(microlitersToUnits(ul(0), upm(100)), { value: 0, rounded: false });
});

test('microlitersToUnits: rounds half up to whole units and flags it', () => {
  // 55 µL on U-100 = 5.5 units → 6
  assert.deepEqual(microlitersToUnits(ul(55), upm(100)), { value: 6, rounded: true });
  // 333 µL on U-100 = 33.3 units → 33
  assert.deepEqual(microlitersToUnits(ul(333), upm(100)), { value: 33, rounded: true });
  // 1 µL on U-100 = 0.1 units → 0
  assert.deepEqual(microlitersToUnits(ul(1), upm(100)), { value: 0, rounded: true });
});

test('microlitersToUnits: other syringes (U-40)', () => {
  assert.deepEqual(microlitersToUnits(ul(250), upm(40)), { value: 10, rounded: false });
  assert.deepEqual(microlitersToUnits(ul(100), upm(40)), { value: 4, rounded: false });
});

test('microlitersToUnits: rejects zero units-per-mL', () => {
  assertCalcThrows(CalcErrorCode.ZERO_UNITS_PER_ML, () => microlitersToUnits(ul(100), upm(0)));
});

test('unitsToMicroliters: U-100 conversions', () => {
  assert.deepEqual(unitsToMicroliters('10', upm(100)), { value: 100, rounded: false });
  assert.deepEqual(unitsToMicroliters('12.5', upm(100)), { value: 125, rounded: false });
  assert.deepEqual(unitsToMicroliters('0.5', upm(100)), { value: 5, rounded: false });
  assert.deepEqual(unitsToMicroliters('100', upm(100)), { value: 1000, rounded: false });
  assert.deepEqual(unitsToMicroliters('0', upm(100)), { value: 0, rounded: false });
});

test('unitsToMicroliters: other syringes (U-40, U-50)', () => {
  assert.deepEqual(unitsToMicroliters('10', upm(40)), { value: 250, rounded: false });
  assert.deepEqual(unitsToMicroliters('1', upm(40)), { value: 25, rounded: false });
  assert.deepEqual(unitsToMicroliters('20', upm(50)), { value: 400, rounded: false });
});

test('unitsToMicroliters: rounds once, half up, to the nearest µL', () => {
  // 1 unit on U-30 → 33.333… µL → 33
  assert.deepEqual(unitsToMicroliters('1', upm(30)), { value: 33, rounded: true });
});

test('unitsToMicroliters: rejects fractional units beyond 2 decimals', () => {
  assertCalcThrows(CalcErrorCode.PRECISION, () => unitsToMicroliters('12.505', upm(100)));
  assertCalcThrows(CalcErrorCode.PRECISION, () => unitsToMicroliters('1.001', upm(100)));
});

test('unitsToMicroliters: rejects junk and zero syringe calibration', () => {
  assertCalcThrows(CalcErrorCode.INVALID, () => unitsToMicroliters('abc', upm(100)));
  assertCalcThrows(CalcErrorCode.INVALID, () => unitsToMicroliters('-5', upm(100)));
  assertCalcThrows(CalcErrorCode.ZERO_UNITS_PER_ML, () => unitsToMicroliters('10', upm(0)));
});

// ---------------------------------------------------------------------------
// ratioToString — display-only long division
// ---------------------------------------------------------------------------

test('ratioToString: half-up rounding at the last digit', () => {
  assert.equal(ratioToString(1, 3, 2), '0.33'); // 0.333… → 0.33
  assert.equal(ratioToString(2, 3, 2), '0.67'); // 0.666… → 0.67 (half up)
  assert.equal(ratioToString(1, 8, 2), '0.13'); // 0.125 → 0.13 (half up)
  assert.equal(ratioToString(1, 3, 0), '0');
  assert.equal(ratioToString(2, 1, 0), '2');
});

test('ratioToString: trims trailing zeros', () => {
  assert.equal(ratioToString(5000, 2000, 2), '2.5');
  assert.equal(ratioToString(5000, 500, 2), '10');
  assert.equal(ratioToString(1, 4, 2), '0.25');
});

test('ratioToString: rejects zero denominator and bad decimals', () => {
  assertCalcThrows(CalcErrorCode.INTERNAL, () => ratioToString(1, 0, 2));
  assertCalcThrows(CalcErrorCode.INTERNAL, () => ratioToString(1, 3, -1));
  assertCalcThrows(CalcErrorCode.INTERNAL, () => ratioToString(1, 3, 7));
});

// ---------------------------------------------------------------------------
// concentrationMgPerMl
// ---------------------------------------------------------------------------

test('concentrationMgPerMl: defaults to 2 decimals', () => {
  assert.equal(concentrationMgPerMl(computeConcentration({ vialUg: ug(5000), diluentUl: ul(2000) })), '2.5');
  assert.equal(concentrationMgPerMl(computeConcentration({ vialUg: ug(5000), diluentUl: ul(500) })), '10');
  assert.equal(concentrationMgPerMl(computeConcentration({ vialUg: ug(1000), diluentUl: ul(3000) })), '0.33');
});

// ---------------------------------------------------------------------------
// Safety-guardrail predicates
// ---------------------------------------------------------------------------

test('doseExceedsVial: strict comparison (equal is not exceeding)', () => {
  assert.equal(doseExceedsVial(ug(1250), ug(1000)), true);
  assert.equal(doseExceedsVial(ug(1000), ug(1000)), false);
  assert.equal(doseExceedsVial(ug(999), ug(1000)), false);
});

test('drawExceedsDiluent: strict comparison (equal is not exceeding)', () => {
  assert.equal(drawExceedsDiluent(ul(5001), ul(5000)), true);
  assert.equal(drawExceedsDiluent(ul(5000), ul(5000)), false);
  assert.equal(drawExceedsDiluent(ul(0), ul(5000)), false);
});

// ---------------------------------------------------------------------------
// CalcError basics
// ---------------------------------------------------------------------------

test('CalcError carries a machine-readable code and human message', () => {
  const err = new CalcError(CalcErrorCode.ZERO_DILUENT, 'no diluent');
  assert.equal(err.name, 'CalcError');
  assert.equal(err.code, CalcErrorCode.ZERO_DILUENT);
  assert.equal(err.message, 'no diluent');
  assert.ok(err instanceof Error);
});
