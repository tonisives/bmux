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
BMUX_OUTPUT_DIR="$directory" pnpm package:bundle
