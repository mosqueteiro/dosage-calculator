# Dosage Calculator

A minimal, private, offline-capable PWA for calculating peptide reconstitution
concentrations and dosage volumes.

- **Reconstitution mode** — enter vial amount + diluent volume + desired dose;
  get concentration, draw volume, and syringe units.
- **Quick dose mode** — concentration already known? Just compute the dose volume.
- **Bidirectional units** — express the dose as mg, mcg, mL, or syringe units;
  all fields update live. U-100 insulin syringe by default, configurable.
- **Presets & history** — save named reconstitution and dose presets; every
  calculation is logged with a timestamp.
- **Offline & installable** — works with no connection; install it to your
  home screen as a PWA.

## Privacy

All data (presets, history, settings) is stored locally on your device in
`localStorage`. There is no backend, no analytics, and no network activity
beyond loading the app itself. Clearing your browser data clears the app.

## Correctness

The math is the part that must never be wrong, so it is engineered accordingly:

- All arithmetic uses **fixed-point integers** (mass in µg, volume in µL) —
  no floating-point drift like `0.1 + 0.2 = 0.30000000000000004`.
- Decimal input is parsed with string-based integer arithmetic.
- Unit types are branded at the type level (via JSDoc + `tsc --checkJs`) so
  mixing units is a compile-time error.
- The calculation module is pure (no DOM access) and covered by unit tests.

> **Disclaimer:** This tool is for informational purposes only. Always verify
> calculations with a healthcare provider before preparing any dose.

## Tech stack

- Vanilla HTML/CSS/JS (ES modules) — **zero runtime dependencies**, no bundler
- TypeScript checking via JSDoc annotations + `tsc --noEmit --checkJs` (dev-only)
- Tests via Node's built-in test runner, `node:test` (dev-only)
- Hand-written service worker + web manifest for PWA/offline support

## Repository layout

```
/index.html              App entry point
/manifest.webmanifest    PWA manifest
/sw.js                   Service worker (offline app shell)
/icons/                  App icons
/src/js/main.js          Bootstrap / wiring
/src/js/lib/calc.js      Pure calculation module (fixed-point integer math)
/src/js/lib/storage.js   localStorage persistence
/src/js/ui/              Calculator, presets, history, settings
/styles/main.css         Styles
/test/                   node:test suites for the calc module
```

## Development

Requirements: [Node.js](https://nodejs.org/) ≥ 18 (for tests and type checking).

```sh
npm install        # installs dev-only tooling (typescript)

npm test           # run unit tests (node --test)
npm run check      # type-check with tsc --noEmit --checkJs
```

There is no build step — the source files are served as-is. Open `index.html`
through any static server during development, e.g.:

```sh
npx serve .
# or
python3 -m http.server 8000
```

## Deployment

The app is hosted on **GitHub Pages**, deployed straight from the `main`
branch (no build artifacts needed). The service worker and manifest use
relative paths so the app works from a project subpath
(`username.github.io/dosage-calculator/`).

## Status

🚧 In active development — see [PLAN.md](PLAN.md) for requirements,
milestones, and the calculation spec.
