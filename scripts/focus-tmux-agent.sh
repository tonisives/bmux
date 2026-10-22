#!/bin/sh
set -eu
exec </dev/null

pane=${BMUX_AGENT_PANE_ID:?Agent pane ID is required}
client=${BMUX_AGENT_FIELD_CLIENT_TTY:-}
if [ -n "$client" ]; then
  tmux switch-client -c "$client" -t "$pane"
else
  tmux switch-client -t "$pane"
fi
tmux select-window -t "$pane"
tmux select-pane -t "$pane"

if [ "$(uname -s)" = Darwin ]; then
  window=${BMUX_AGENT_FIELD_TERMINAL_WINDOW_ID:-}
  case "$window" in
    ''|*[!0-9]*) hs -c 'hs.application.launchOrFocus("Alacritty")' ;;
    *) hs -c "local w=hs.window.get($window); if w then w:focus() else hs.application.launchOrFocus(\"Alacritty\") end" ;;
  esac
fi
