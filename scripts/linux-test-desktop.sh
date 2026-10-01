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
exec "$@"
