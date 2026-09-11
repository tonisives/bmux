#!/bin/sh
set -eu
"$BMUX_CLI" plugin host eval '{"expression":"document.documentElement.dataset.bmuxPluginReady = \"true\"; true"}'
"$BMUX_CLI" plugin host progress '{"percent":100,"message":"Local fixture is ready"}'
