#!/bin/sh
set -eu
exec </dev/null

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
pane=$(node "$script_dir/../bin/tmux-agent.mjs" focus-pane)
tmux_agent() {
  if [ -n "${BMUX_AGENT_SOCKET_PATH:-}" ]; then
    tmux -S "$BMUX_AGENT_SOCKET_PATH" "$@"
  else
    tmux "$@"
  fi
}
client=${BMUX_AGENT_FIELD_CLIENT_TTY:-}
if [ -n "$client" ]; then
  tmux_agent switch-client -c "$client" -t "$pane"
else
  tmux_agent switch-client -t "$pane"
fi
tmux_agent select-window -t "$pane"
tmux_agent select-pane -t "$pane"

if [ "$(uname -s)" = Darwin ]; then
  window=${BMUX_AGENT_FIELD_TERMINAL_WINDOW_ID:-}
  case "$window" in
    ''|*[!0-9]*) hs -c 'hs.application.launchOrFocus("Alacritty")' ;;
    *) hs -c "local w=hs.window.get($window); if w then w:focus() else hs.application.launchOrFocus(\"Alacritty\") end" ;;
  esac
fi
