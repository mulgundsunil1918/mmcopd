#!/usr/bin/env bash
# One command for a release build: the Windows installer, then the macOS disk image, one after the other (never two Vite builds at once).
#
# EVERY BUILD GETS A NEW VERSION NUMBER (owner's rule, 2026-10-27: 1.0.0, then 1.0.1, 1.0.2 ...). The file names follow the version in package.json, so BUMP IT FIRST:
#   npm version patch --no-git-tag-version        # 1.0.0 -> 1.0.1   (a bigger step: npm version 1.1.0 --no-git-tag-version)
#   git commit -am "version 1.0.1"
#   npm run build:all
# Outputs: dist-installer/CureDesk-HMS-Setup-<version>.exe and out/make/CureDesk-HMS-<version>.dmg. Never launch the packaged app on the dev Mac to check it
# (it would open the owner's own data): look inside with `hdiutil attach -readonly` and `npx asar extract` instead.
set -u
cd "$(dirname "$0")/.." || exit 1
export CSC_IDENTITY_AUTO_DISCOVERY=false
VER=$(node -p "require('./package.json').version")
DMG="out/make/CureDesk-HMS-$VER.dmg"
EXE="dist-installer/CureDesk-HMS-Setup-$VER.exe"
echo "==> building CureDesk $VER (commit $(git rev-parse --short HEAD 2>/dev/null || echo '?'))"
if [ -n "$(git status --porcelain 2>/dev/null | grep -v '^??')" ]; then echo "!! uncommitted changes in the working tree - commit first, so the installers match a commit"; fi

# start from nothing: old packaged folders, this version's old outputs, the Vite output and any compiled test bundles (they would be packed into the app)
rm -rf "out/CureDesk HMS-win32-x64" "out/CureDesk HMS-darwin-x64" "$DMG" "out/make/zip" "$EXE" ".vite" ".vite-test" 2>/dev/null

npm run build:win || { echo "!! the Windows build failed"; exit 1; }

( npm run make ) &
FORGE=$!
end=$(( $(date +%s) + 2400 ))
while [ "$(date +%s)" -lt "$end" ]; do
  if [ -f "$DMG" ]; then sleep 30; break; fi          # forge can linger after the image exists; give it 30 s to finish by itself
  sleep 10
done
pkill -P $FORGE 2>/dev/null; kill $FORGE 2>/dev/null; pkill -f "electron-[f]orge" 2>/dev/null

if [ -f "$DMG" ] && [ -f "$EXE" ]; then
  echo "==> done: CureDesk $VER"
  ls -l "$EXE" "$DMG" | awk '{print $5, $9}'
  shasum -a 256 "$EXE" "$DMG"
else
  echo "!! the build is incomplete (exe: $([ -f "$EXE" ] && echo yes || echo NO), dmg: $([ -f "$DMG" ] && echo yes || echo NO))"
  exit 1
fi
