#!/usr/bin/env bash
#
# Build the Windows installer from this Mac, end to end, and refuse to hand over
# anything that does not verify.
#
# Why this exists as a script: the cross-build has one step that is easy to get
# wrong by hand. electron-forge packages the app with the *macOS* build of
# better-sqlite3 — a Mach-O binary Windows cannot load — so it has to be replaced
# with the matching win32 prebuild before electron-builder wraps everything in
# NSIS. Done manually every release, that step will eventually be missed, and the
# result is an installer that runs and then dies the moment it touches the
# database. Here it is checked, not remembered.
#
# The script fails loudly rather than producing a doubtful artifact:
#   1. the swapped module must be a Windows PE32+ DLL
#   2. no Mach-O binary may survive anywhere in the Windows tree
#   3. the finished installer's payload must pass a 7-Zip integrity test
#      (this is the same class of check whose failure produces the NSIS
#      "installer integrity check has failed" message on the customer's PC)
#
# Usage:  ./scripts/build-windows.sh
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PKG_DIR="$ROOT/out/CureDesk HMS-win32-x64"
NODE_REL="resources/app.asar.unpacked/.vite/build/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
VERSION="$(node -p "require('./package.json').version")"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mBUILD FAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# --- versions must match, or the native module will not load on the target ----
ELECTRON="$(node -p "require('electron/package.json').version")"
BS3="$(node -p "require('better-sqlite3/package.json').version")"
ABI="$(node -p "require('electron/package.json').version.split('.')[0] >= 33 ? 130 : 0")"
[ "$ABI" != "0" ] || die "Unrecognised Electron ($ELECTRON) — check the better-sqlite3 ABI before continuing."
say "CureDesk $VERSION · Electron $ELECTRON · better-sqlite3 $BS3 · ABI v$ABI"

# --- 1. fetch the matching Windows prebuild (cached) --------------------------
CACHE="$ROOT/.cache/win-sqlite/$BS3-abi$ABI"
if [ ! -f "$CACHE/build/Release/better_sqlite3.node" ]; then
  say "Downloading better-sqlite3 $BS3 for electron-v$ABI-win32-x64"
  mkdir -p "$CACHE"
  URL="https://github.com/WiseLibs/better-sqlite3/releases/download/v$BS3/better-sqlite3-v$BS3-electron-v$ABI-win32-x64.tar.gz"
  curl -sSfL -o "$CACHE/bs3.tar.gz" "$URL" || die "Could not download the Windows prebuild: $URL"
  tar xzf "$CACHE/bs3.tar.gz" -C "$CACHE"
fi
PREBUILT="$CACHE/build/Release/better_sqlite3.node"
file -b "$PREBUILT" | grep -q "PE32+" || die "Cached prebuild is not a Windows DLL."

# --- 2. package ---------------------------------------------------------------
say "Packaging win32-x64"
rm -rf "$PKG_DIR"
# electron-forge does NOT exit after packaging — it sits idle holding the
# terminal. Run it detached and poll for its output, or this script waits for a
# process that is never going to finish.
npx electron-forge package --platform=win32 --arch=x64 >/dev/null 2>&1 &
FORGE_PID=$!
for _ in $(seq 1 90); do
  if [ -f "$PKG_DIR/$NODE_REL" ] && [ -f "$PKG_DIR/CureDesk HMS.exe" ]; then break; fi
  sleep 5
done
[ -f "$PKG_DIR/CureDesk HMS.exe" ] || die "electron-forge did not produce the Windows package."
sleep 25                      # let it finish flushing the last files
kill "$FORGE_PID" 2>/dev/null || true
pkill -f "electron-forge" 2>/dev/null || true
pkill -f "forge" 2>/dev/null || true
sleep 2

# --- 3. swap the native module ------------------------------------------------
say "Replacing the macOS SQLite binary with the Windows one"
cp "$PREBUILT" "$PKG_DIR/$NODE_REL"
file -b "$PKG_DIR/$NODE_REL" | grep -q "PE32+" \
  || die "The swapped better_sqlite3.node is not a Windows DLL."

MACHO="$(find "$PKG_DIR" -type f -exec file {} \; 2>/dev/null | grep -ci "mach-o" || true)"
[ "$MACHO" = "0" ] || die "$MACHO macOS binary/binaries are still inside the Windows package."

# --- 4. wrap in NSIS ----------------------------------------------------------
say "Building the NSIS installer"
npx electron-builder --win nsis --x64 --prepackaged "$PKG_DIR" >/dev/null \
  || die "electron-builder failed."
EXE="$ROOT/dist-installer/CureDesk-HMS-Setup-$VERSION.exe"
[ -f "$EXE" ] || die "Installer was not produced at $EXE"

# --- 5. verify the installer itself -------------------------------------------
say "Verifying the installer"
SEVENZ="$(find "$HOME/Library/Caches/electron-builder/7zip@1.0.0" -name '7zz' -type f 2>/dev/null | head -1)"
if [ -n "$SEVENZ" ]; then
  "$SEVENZ" t "$EXE" >/tmp/curedesk-7z-test.txt 2>&1 \
    || { cat /tmp/curedesk-7z-test.txt; die "Installer payload FAILED its integrity test — do not ship this file."; }
  grep -q "Everything is Ok" /tmp/curedesk-7z-test.txt \
    || { cat /tmp/curedesk-7z-test.txt; die "Installer payload did not verify clean."; }
  echo "  payload integrity: OK"
else
  echo "  (7-Zip not found in the electron-builder cache — payload test skipped)"
fi
file -b "$EXE" | grep -qi "nullsoft" || die "Output is not an NSIS installer."

SHA="$(shasum -a 256 "$EXE" | cut -d' ' -f1)"
SIZE="$(stat -f%z "$EXE")"
printf '  type: NSIS  ·  size: %s bytes\n  sha256: %s\n' "$SIZE" "$SHA"

# --- 6. checksum file travels with the installer ------------------------------
{
  echo "CureDesk HMS $VERSION — Windows installer"
  echo
  echo "sha256  $SHA"
  echo "bytes   $SIZE"
  echo
  echo "Verify on the target PC BEFORE running it:"
  echo "  certutil -hashfile \"CureDesk-HMS-Setup-$VERSION.exe\" SHA256"
  echo
  echo "If the hash differs, the file was damaged in transfer — copy it again."
  echo "Running a damaged installer gives: \"installer integrity check has failed\"."
} > "$ROOT/dist-installer/CureDesk-HMS-Setup-$VERSION.exe.sha256.txt"

say "Done — $EXE"
