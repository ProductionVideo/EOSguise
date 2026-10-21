#!/usr/bin/env bash
# cuedo one-line installer for macOS and Linux:
#   curl -fsSL https://cues.stage.wiki/install.sh | bash
# Downloads cuedo from GitHub with curl (so macOS Gatekeeper does not quarantine it) and runs its installer,
# which installs for the current user, starts cuedo at login and opens it. Windows: use install-windows.cmd.
set -euo pipefail
REPO="ProductionVideo/cuedo"
REF="${CUEDO_REF:-main}"
case "$(uname -s)" in Darwin|Linux) ;; *) echo "cuedo: this installer is for macOS and Linux. On Windows, run install-windows.cmd from https://github.com/$REPO"; exit 1;; esac
command -v curl >/dev/null && command -v tar >/dev/null || { echo "cuedo: curl and tar are required"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "Downloading cuedo ($REF) from github.com/$REPO..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -f "$SRC/scripts/install.sh" ] || { echo "cuedo: download did not contain the installer"; exit 1; }
# Read from the terminal, not this piped script, if the installer ever asks anything.
bash "$SRC/scripts/install.sh" "$@" </dev/null
