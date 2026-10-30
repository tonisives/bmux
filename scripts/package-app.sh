#!/bin/sh
set -eu

directory=${BMUX_OUTPUT_DIR:-build}
mkdir -p "$directory"
directory=$(cd "$directory" && pwd -P)
lock="$directory/.bmux-build.lock"
failure="$directory/.bmux-build-failed"
if ! mkdir "$lock" 2>/dev/null; then
  echo "A bmux build is already in progress: $lock" >&2
  exit 1
fi

finish() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    echo "bmux packaging failed (exit $status). Run pnpm package again; see the build output." > "$failure"
  fi
  rmdir "$lock"
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
rm -f "$failure"
architecture=$(uname -m)
case "$architecture" in
  arm64) bundle=release/mac-arm64/bmux.app ;;
  *) bundle=release/mac/bmux.app ;;
esac
python3 scripts/build-local.py run --prepare-node --output "$bundle=$PWD/$bundle" --   sh -c 'pnpm build && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac --dir'
BMUX_OUTPUT_DIR="$directory" BMUX_DEFAULT_SIGNING_IDENTITY=EF765C5EE39AC9C656688DD1DFB230405C03F735   node scripts/install-app.mjs --source "$bundle"
