#!/bin/bash
set -euo pipefail

# This script is copied beside the generated Xcode workspace during preparation.
app_dir="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$app_dir"
export CI=1
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v node >/dev/null || [[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 24')" != true ]]; then
    brew install node@24
    export PATH="$(brew --prefix node@24)/bin:$PATH"
fi
pnpm_version="$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')"
npm install --prefix "$HOME/.mobile-cloud-tools" "pnpm@$pnpm_version"
export PATH="$HOME/.mobile-cloud-tools/node_modules/.bin:$PATH"
pnpm install --frozen-lockfile --child-concurrency=4

# The native project is already generated from this exact commit on GitHub.
# Avoid regenerating it here: Apple selected the workspace and scheme before this hook.
cd ios
printf 'export NODE_BINARY="%s"\n' "$(command -v node)" > .xcode.env.local
if ! command -v pod >/dev/null; then
    brew install cocoapods
fi
pod install
: "${CI_BUILD_NUMBER:?Xcode Cloud must supply CI_BUILD_NUMBER}"
xcrun agvtool new-version -all "$CI_BUILD_NUMBER"
