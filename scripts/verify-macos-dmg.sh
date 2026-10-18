#!/usr/bin/env bash
set -euo pipefail

artifact="${1:?Usage: verify-macos-dmg.sh DMG arm64|x64}"
case "${2:-}" in
  arm64) arch=arm64 ;;
  x64) arch=x86_64 ;;
  *) echo "Expected arm64 or x64" >&2; exit 1 ;;
esac

codesign --verify --strict "$artifact"
hdiutil verify "$artifact"
mountpoint=$(mktemp -d "${TMPDIR:-/tmp}/bmux-dmg-verify.XXXXXX")
mounted=false
cleanup() {
  if "$mounted"; then hdiutil detach "$mountpoint"; fi
  rmdir "$mountpoint"
}
trap cleanup EXIT
hdiutil attach "$artifact" -readonly -nobrowse -mountpoint "$mountpoint"
mounted=true

validate_ticket() {
  local app="$1" log status attempt
  log=$(mktemp "${TMPDIR:-/tmp}/bmux-stapler.XXXXXX")
  for attempt in 1 2 3; do
    if xcrun stapler validate "$app" >"$log" 2>&1; then
      cat "$log"; rm -f "$log"; return 0
    else
      status=$?
    fi
    cat "$log"
    # Error 68 alone can mean an invalid ticket. Retry only the observed
    # CloudKit connection-loss failure, preserving every verification check.
    if [ "$status" -ne 68 ] || ! grep -q 'Error Domain=NSURLErrorDomain Code=-1005' "$log" || [ "$attempt" -eq 3 ]; then
      rm -f "$log"; return "$status"
    fi
    echo "CloudKit connection lost during ticket validation; retry $attempt/2 in 5 seconds"
    sleep 5
  done
}

verify_app() {
  local app="$1"
  test -s "$app/Contents/_CodeSignature/CodeResources"
  codesign --verify --deep --strict --verbose=2 -R='anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists' "$app"
  validate_ticket "$app"
  spctl --assess --type execute --verbose=4 "$app"
  lipo "$app/Contents/MacOS/bmux" -verify_arch "$arch"
  lipo "$app/Contents/Resources/app.asar.unpacked/out/native/pointer.node" -verify_arch "$arch"
}
verify_app "$mountpoint/bmux.app"

zip="${artifact%.dmg}.zip"
extracted=$(mktemp -d "${TMPDIR:-/tmp}/bmux-zip-verify.XXXXXX")
trap 'cleanup; rm -rf "$extracted"' EXIT
ditto -x -k "$zip" "$extracted"
verify_app "$extracted/bmux.app"
echo "Verified $artifact and $zip: Developer ID, notarization, and $arch executables"
