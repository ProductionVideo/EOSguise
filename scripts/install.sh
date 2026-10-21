#!/usr/bin/env bash
# macOS and Linux installer: copies cuedo to a per-user folder, provides a checksum-verified Node runtime,
# then runs scripts/setup.mjs to configure, register at login, start and open it.
set -euo pipefail
PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION=v22.23.1
case "$(uname -s)" in
 Darwin) OS=darwin; APP="${CUEDO_HOME:-$HOME/Library/Application Support/cuedo}";;
 Linux) OS=linux; APP="${CUEDO_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/cuedo}";;
 *) echo "cuedo: unsupported system $(uname -s)"; exit 1;;
esac
case "$(uname -m)" in
 arm64|aarch64) ARCH=arm64;;
 x86_64|amd64) ARCH=x64;;
 *) echo "cuedo: unsupported processor $(uname -m)"; exit 1;;
esac
case "$OS-$ARCH" in
 darwin-arm64) SHA=ef28d8fab2c0e4314522d4bb1b7173270aa3937e93b92cb7de79c112ac1fa953;;
 darwin-x64) SHA=b8da981b8a0b1241b70249204916da76c63573ddf5814dbd2d1e41069105cb81;;
 linux-arm64) SHA=543fa39e57d4c07855939459a323f4deb9a79dd1bb45e6e99458b0f2de10db8d;;
 linux-x64) SHA=7a8cb04b4a1df4eaf432125324b81b29a088e73570a23259a8de1c65d07fc129;;
esac
echo "Installing cuedo to $APP"
mkdir -p "$APP"

# Copy the application. Settings, logs and the runtime already in the install folder are kept.
if [ "$(cd "$APP" && pwd)" != "$PKG" ]; then
 (cd "$PKG" && tar cf - --exclude=./.git --exclude=./cloud --exclude=./tests --exclude=./branding --exclude=./runtime \
   --exclude=./node_modules --exclude='./test-*.mjs' --exclude=./config.json --exclude=./config.next.json \
   --exclude='*.log' --exclude='*.jsonl' --exclude=.DS_Store .) | (cd "$APP" && tar xf -)
fi

# Node runtime: keep the pinned one, use a tarball bundled beside the installer (offline installs), or download it.
NODE="$APP/runtime/node"
if [ ! -x "$NODE" ] || [ "$("$NODE" --version 2>/dev/null || true)" != "$NODE_VERSION" ]; then
 NAME="node-$NODE_VERSION-$OS-$ARCH"
 TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
 if [ -f "$PKG/runtime/$NAME.tar.gz" ]; then cp "$PKG/runtime/$NAME.tar.gz" "$TMP/"
 else
  echo "Downloading Node.js $NODE_VERSION from nodejs.org..."
  curl -fL --progress-bar -o "$TMP/$NAME.tar.gz" "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz"
 fi
 if command -v sha256sum >/dev/null; then ACTUAL="$(sha256sum "$TMP/$NAME.tar.gz" | cut -d' ' -f1)"; else ACTUAL="$(shasum -a 256 "$TMP/$NAME.tar.gz" | cut -d' ' -f1)"; fi
 if [ "$ACTUAL" != "$SHA" ]; then echo "cuedo: Node download checksum mismatch. Nothing was installed."; exit 1; fi
 tar -xzf "$TMP/$NAME.tar.gz" -C "$TMP" "$NAME/bin/node" "$NAME/LICENSE"
 mkdir -p "$APP/runtime"
 mv -f "$TMP/$NAME/bin/node" "$NODE"; mv -f "$TMP/$NAME/LICENSE" "$APP/runtime/LICENSE"
 rm -rf "$TMP"; trap - EXIT
fi

exec "$NODE" "$APP/scripts/setup.mjs" "$@"
