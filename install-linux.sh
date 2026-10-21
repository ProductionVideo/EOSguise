#!/usr/bin/env bash
# Installs cuedo for this Linux user, starts it at login and opens it.
exec bash "$(dirname "$0")/scripts/install.sh" "$@"
