# PLAN.md — Dosage Calculator PWA

A minimal, private, offline-capable PWA for calculating peptide reconstitution
concentrations and dosage volumes. Hosted on GitHub Pages. No runtime
dependencies, no backend, all data stored locally on the user's device.

---

## 1. Goals

- Calculate **reconstitution concentration** (vial amount + diluent → mg/mL).
- Calculate **dosage volume** (dose → mL and syringe units), in two modes:
  - **Reconstitution mode**: full flow (vial amount + diluent volume + desired dose).
  - **Quick dose mode**: concentration already known; just compute dose volume.
- **Save** named reconstitution presets and dose presets; **log** past calculations.
- Run fully offline, installable as a PWA.
- **Privacy**: all data stays on-device. No analytics, no network calls after install.
- Minimal dependencies: zero runtime dependencies.

## 2. Non-Goals

- No accounts, sync, or server-side storage.
- No medical database of substances or dosing guidelines.
- No support for non-peptide injection workflows (e.g., vaccine mixing schedules).

## 3. Functional Requirements

### 3.1 Reconstitution Calculator
- Inputs: vial amount (`mg`), diluent volume (`mL`), desired dose (`mg` or `mcg`).
- Output: concentration (`mg/mL`), draw volume (`mL`), and syringe units.
- Inputs are editable in either direction (see 3.3).

### 3.2 Quick Dose Calculator
- Input: known concentration (`mg/mL`) + desired dose (`mg`/`mcg`).
- Output: draw volume (`mL`) and syringe units.

### 3.3 Configurable Units (bidirectional)
- The dose can be expressed as **mg, mcg, mL, or syringe units**; changing any
  dose field updates the others live (configurable units).
- **U-100 insulin syringe is the default** (100 units = 1 mL); the
  units-per-mL factor is user-configurable in Settings for other syringes.
- Dose in mL ties directly to the draw volume.

### 3.4 Presets
- **Reconstitution presets**: name, vial amount (`mg` or `mcg`), diluent
  volume. Tapping one loads it into the calculator.
- **Dose presets**: name, dose amount + unit, optional link to a reconstitution
  preset. Tapping one loads it into the calculator.

### 3.5 History Log
- Every completed calculation is appended to a timestamped history list.
- Entries show inputs → results at a glance; tapping an entry reloads its inputs.
- Entries are **individually deletable**, plus a "clear all" action (with confirm).
- History is capped (e.g., last 200 entries) to bound storage.

### 3.6 Safety Guardrails
- Persistent, prominent disclaimer: *informational tool only — verify all
  calculations with a healthcare provider.*
- Inline warnings when a result is physically impossible or unusual, e.g.:
  - Draw volume exceeds the total diluent volume.
  - Dose exceeds the vial's total content.
  - Negative / zero / non-numeric input.
- Warnings are visible, not blocking (user can still read the number).

## 4. Calculation Spec (single source of truth)

All math lives in one pure module (`src/js/lib/calc.js`) with no DOM access,
so it can be exhaustively unit-tested.

### 4.1 Arithmetic precision (no floating-point drift)

No floats participate in arithmetic — `0.1 + 0.2 = 0.30000000000000004` class
bugs are impossible by construction:

- **Fixed-point integer representation.** Mass is stored in **micrograms
  (µg)**; volume in **microliters (µL)**. Convenient identity: `1 mg/mL =
  1 µg/µL`, so concentration stays integer-friendly. All realistic values
  (≤ ~100 mg = 100,000,000 µg) are far below `Number.MAX_SAFE_INTEGER`, so
  plain integers suffice — no BigInt, no decimal library.
- **Decimal parsing is string-based.** User input `"0.25"` is split on the
  decimal point into `250000` µg via integer arithmetic on the digit strings.
  Never `Number(input) * 1000` (that is itself lossy: `0.1 * 1000 ===
  100.00000000000001`).
- **Division rounding policy.** Division is the only non-integer operation
  (e.g., 250 µg ÷ 3 µg/µL). Results are rounded to the nearest µL (round
  half up). 1 µL = 0.001 mL, ten times finer than the 0.01 mL gradation of a
  U-100 syringe, so this loses no practical precision. Rounded results are
  flagged in the UI (e.g., shown with a `≈` marker).
- **Rounding happens once, at the boundary.** Intermediate values stay
  integers; only division results are rounded, and never re-rounded.
- Every rule above is enforced by `node:test` cases, including regression
  tests for the classic float traps (`0.1 + 0.2`, `0.1 * 1000`, `1/3`-style
  non-terminating division).

### 4.2 Formulas and edge cases

```
concentration(mg/mL) = vialAmount(µg) / diluentVolume(µL)   // = µg/µL
drawVolume(µL)       = dose(µg) / concentration(µg/µL)
syringeUnits         = drawVolume(µL) × unitsPerMl / 1000   // default 100 (U-100)
dose(µg)             = drawVolume(µL) × concentration(µg/µL)
```

Edge cases to specify and test:
- Diluent volume of 0 → error, not division by zero.
- Rounding: display values rounded to a sensible precision (e.g., 2 decimals
  for mL, whole units for syringe units) — display-only, derived from the
  integer internal value, never fed back into calculations.
- mcg↔mg conversions applied consistently (integer ×/÷ 1000).
- Concentration exceeding vial amount (e.g., 5 mg in 0.5 mL) is legal input.

**Correctness strategy:**
- JSDoc type annotations throughout, checked by `tsc --noEmit --checkJs`.
- Branded types for units (`Mg`, `Mcg`, `Ml`, `SyringeUnits`, and integer
  internals `Micrograms`, `Microliters`) so mixing units is a compile-time
  error, not a silent bug.
- `node:test` (built-in, zero deps) covers the calc module, including edge
  cases and float-drift regressions.

## 5. Data Model & Storage

- Storage: `localStorage` (single JSON key per store). Simple, synchronous,
  plenty for this data size. Everything is on-device; no permissions needed.
- Stores:
  - `settings` — `{ unitsPerMl, ... }`
  - `reconstitutionPresets` — `{ id, name, vialAmount, vialUnit ("mg"|"mcg"), diluentMl, createdAt }`
  - `dosePresets` — `{ id, name, doseAmount, doseUnit, linkedPresetId?, createdAt }`
  - `history` — `{ id, timestamp, mode, inputs, results }` (FIFO, capped)
- IDs: `crypto.randomUUID()`.

## 6. Tech Stack & Architecture

- **Vanilla HTML/CSS/JS** (ES modules). No framework, no bundler, no runtime deps.
- **JSDoc types + `tsc --noEmit --checkJs`** as a dev-time check (dev dependency
  only: `typescript`; optionally `gh action` runs it in CI).
- **`node:test`** for unit tests (dev-time only).
- **PWA**: `manifest.webmanifest` + a small hand-written service worker
  (cache-first app shell for offline use), app icons.
- File layout:

```
/index.html
/manifest.webmanifest
/sw.js
/icons/
/src/js/main.js
/src/js/lib/calc.js        ← pure math, fully tested
/src/js/lib/storage.js
/src/js/ui/*.js            ← calculator, presets, history, settings
/styles/main.css
/test/calc.test.js
```

- All paths relative (GitHub Pages project sites are served from `/repo/`).
- Service worker registered with a relative scope.

## 7. Deployment (GitHub Pages)

- Deploy **from the `main` branch** (Pages: deploy from branch → `/root`).
  No GitHub Actions build required since there's no build step.
- Dev dependency check (`tsc`, `node --test`) can run in a CI workflow on push,
  but is not part of deployment.

## 8. Milestones

1. **Core calc module** — pure functions + branded types + full `node:test`
   coverage, including fixed-point arithmetic and float-drift regressions
   (this is the correctness foundation).
2. **Calculator UI** — both modes, bidirectional units, inline warnings,
   disclaimer.
3. **Presets + history** — CRUD, localStorage, load-back-into-calculator,
   deletable history entries.
4. **PWA-ify** — manifest, service worker, icons, offline verification,
   installability.
5. **Polish & deploy** — responsive/mobile-first styling, dark mode (optional),
   enable GitHub Pages, end-to-end smoke test on the live URL.
6. **Post-MVP backlog** — settings for units-per-mL beyond U-100; data
   export/import (JSON backup); IU vial amounts if needed.

## 9. Open Questions

- Preset vial amounts: support `IU` (in addition to `mg`/`mcg`)? Requires
  deciding how IU mass-equivalents are handled — defer unless requested.
