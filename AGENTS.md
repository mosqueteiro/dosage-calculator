# AGENTS.md

## Commands

- `devenv shell` — enter the dev environment (Node 24, npm, Python).
- `devenv up -d` — serve the repo in the background at http://localhost:8000 (Python http.server, no deps). Stop with `devenv processes down`, or run `devenv up` for a foreground server.
- `devenv test` — CI-equivalent check. Today it only verifies toolchain versions; once `package.json` exists it runs `npm install`, `npm test`, `npm run check` automatically.
- There is no build step. Source files are served as-is; never add a bundler without discussing first.

## Toolchain quirks (hard-earned)

- **`devenv test` vs running processes**: `devenv test` fails with "Processes already running" while a `devenv up -d` server is up. Either `devenv processes down` first, or run `devenv shell -- npm test` / `npm run check` directly (the server stays up).
- **Service worker caching**: `sw.js` is cache-first — after changing any app asset, bump `CACHE_VERSION` in `sw.js`, or the installed app keeps serving stale files. (Dev server + hard reload also gets confused by SW caches; the headless-screenshot profiles sidestep it.)

- **Dev server caching**: `python3 -m http.server` sends no `Cache-Control`, so browsers heuristically cache CSS/JS — soft reloads can serve stale assets (use hard reload, or a fresh `--profile` dir for headless-Firefox screenshots). Decided: we keep plain http.server anyway.

- **devenv 2.4 gotcha**: a legacy `enterTest = "…"` string is *not* executed by `devenv test` (the script builds into the Nix store but nothing invokes it). Tests must be defined as `tasks."devenv:enterTest".exec` in `devenv.nix`, with `showOutput = true` or output is hidden.
- devenv requires `languages.javascript.npm.enable = true` before `npm.install.enable` (assertion error otherwise).
- `package.json` does not exist yet — it arrives with Milestone 1 (see PLAN.md). `npm` commands fail until then.

## Math correctness constraints (non-negotiable)

The dosage math is the core of this app; these rules come from PLAN.md §4 and tests will enforce them:

- All arithmetic is fixed-point integer: mass in **µg**, volume in **µL** (`1 mg/mL = 1 µg/µL`). Never do float arithmetic on doses/volumes.
- Parse decimal input with string-based integer arithmetic, never float
  arithmetic on doses (`0.1 + 0.2 === 0.30000000000000004`,
  `0.3 / 0.1 === 2.9999999999999996`).
- Division rounds once, to the nearest µL (round half up); never re-round intermediates.
- All math lives in `src/js/lib/calc.js` as pure functions (no DOM) so `node --test` can cover it exhaustively.
- Types via JSDoc annotations, checked by `tsc --noEmit --checkJs`; use branded unit types so mixing units is a compile error.

## Conventions

- Conventional commits (`docs:`, `chore:`, `feat:`, `fix:`).
- All asset/service-worker paths must be relative — GitHub Pages serves this from `/dosage-calculator/`, not `/`.
- Privacy by design: no network calls after load, no analytics, data stays in `localStorage`.
- `PLAN.md` is the requirements source of truth; update it when requirements change, not just the code.
