#!/bin/sh
set -eu

# Native focus and window stacking require a window manager, even under Xvfb.
openbox >/tmp/bmux-test-window-manager.log 2>&1 &
manager=$!
attempt=0
while :; do
  kill -0 "$manager"
  case "$(xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null)" in
    *"window id #"*) break ;;
  esac
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "Test desktop window manager did not become ready" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "${BMUX_NATIVE_CRASH_DIAGNOSTICS:-0}" != 1 ]; then
  exec "$@"
fi
status=0
"$@" || status=$?
mkdir -p /tmp/results
for core in /tmp/bmux-core.*; do
  [ -f "$core" ] || continue
  # Only stack frames are retained; profile memory stays inside this container.
  timeout 30 gdb --batch -ex 'set print frame-arguments none' \
    -ex 'thread apply all bt' node_modules/electron/dist/electron "$core" \
    >"/tmp/results/native-crash-${core##*.}.txt" 2>&1 || true
  rm -f "$core"
done
exit "$status"
