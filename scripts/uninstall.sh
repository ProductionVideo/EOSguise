#!/usr/bin/env bash
# Stops cuedo and removes it from login items. Settings and files are kept.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/../runtime/node" "$DIR/setup.mjs" --uninstall
