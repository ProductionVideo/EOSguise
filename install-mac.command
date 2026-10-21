#!/bin/bash
# Double-click in Finder: installs cuedo for this Mac user, starts it at login and opens it.
cd "$(dirname "$0")" || exit 1
if bash scripts/install.sh; then echo; echo "Done. You can close this window."; else echo; echo "Installation failed. See the message above."; fi
