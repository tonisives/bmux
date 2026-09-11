#!/bin/sh
set -eu
"$BMUX_CLI" plugin host eval '{"expression":"document.title"}' |
  "$BMUX_CLI" plugin host result --stdin
