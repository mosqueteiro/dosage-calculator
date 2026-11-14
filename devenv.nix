{
  pkgs,
  lib,
  config,
  inputs,
  ...
}:

{
  # Node.js + npm: dev-only tooling (tsc type checking, node:test runner).
  # There is no build step — the app source is served as-is.
  languages.javascript.enable = true;

  # Auto-run `npm install` on shell entry (no-op until package.json exists in M1).
  languages.javascript.npm.enable = true;
  languages.javascript.npm.install.enable = true;

  packages = [
    pkgs.git
    # Zero-dependency static dev server (`serve` script below).
    pkgs.python3
  ];

  # Serve the app locally for manual testing: http://localhost:8000
  # Managed lifecycle: `devenv up` (foreground) or `devenv up -d` (background),
  # stopped with `devenv processes down`.
  processes.serve.exec = "python3 -m http.server 8000";

  # `devenv test` — CI-equivalent quality gate.
  # npm test / npm run check arrive with package.json in Milestone 1.
  tasks."devenv:enterTest" = {
    showOutput = true;
    exec = ''
      node --version
      npm --version
      if [ -f package.json ]; then
        npm install
        npm test
        npm run check
      fi
    '';
  };
}
