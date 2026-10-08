# Packaging

The current packaging command builds the app and installs the finished bundle in `build/bmux.app`:

```sh
pnpm package
```

The command replaces the previous bundle only after the new build succeeds. It doesn't restart a running app. The `release/` directory is temporary packaging output.

Published releases are created from the private workspace's main checkout with
`make release-desktop`. That target increments the patch version in the public
repository, pushes the release commit, and creates a GitHub release. The release
workflow builds macOS arm64 and x64 DMGs, Linux arm64 and x64 host archives, and
a Windows x64 installer. Linux archives contain the portable host runtime;
Windows is an unsigned desktop installer. Verify the release workflow and its
assets before announcing a release.

Release CI imports the Developer ID certificate, signs the app and all nested code with Electron Builder, submits the app to Apple for notarization, and staples the accepted ticket before creating the signed DMG and updater ZIP. The app and helpers share the Electron runtime entitlements. CI checks both extracted artifacts for their resource seal, Developer ID signature, stapled ticket, Gatekeeper acceptance, and executable architectures before publishing. Missing signing or notarization credentials fail the build.

The local package step then signs with bmux's Developer ID identity when it is installed in Keychain and verifies the complete bundle after installation. Set `BMUX_SIGNING_IDENTITY` to use another certificate hash. Builds without the bmux identity keep their ad-hoc signature and are not notarized. See [Platform notes](platforms.md) for host requirements and the status of other platforms.

## macOS first launch

Current releases are Developer ID signed and notarized. macOS may ask you to confirm that you downloaded the app; it should not report a damaged bundle. See [Apple's first-launch instructions](https://support.apple.com/102445).

The v0.1.3 DMGs have a packaging defect: the app is missing its bundle resource seal. This is different from an unidentified-developer warning. Reinstalling that version cannot fix it. Check an installed bundle with:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/bmux.app
```

If it reports `code has no resources but signature indicates they must be present`, use a newer release containing the signing fix, or build from source with `pnpm package`. Do not remove quarantine or disable Gatekeeper to repair a failed signature. A passing `codesign` check verifies bundle integrity. Release verification also runs `xcrun stapler validate` and `spctl --assess --type execute` to check notarization and Gatekeeper acceptance.

## Automatic updates

macOS release builds check five seconds after startup and once per day. Updates download in the background and are staged only after native signature verification. They apply on quit; bmux never restarts automatically during a session. Use **bmux > Check for Updates** for a manual check or **Restart to Update** when an update is ready. The **Automatically Check for Updates** menu item persists `automaticUpdates: false` in the existing YAML configuration when disabled.

Development builds, local packages without a release feed, disposable test profiles, and Linux/Windows builds do not check for updates. Users of v0.1.3 need to install the first fixed release manually because that version has no updater.

Each architecture publishes its signed, notarized ZIP plus `latest-arm64-mac.yml` or `latest-x64-mac.yml` to GitHub Releases. The metadata is published after its assets and is checked against their SHA-512 hashes and sizes. Keep using the same Developer ID identity for future releases so installed apps can verify updates.

The GitHub Release workflow requires `APPLE_CERTIFICATE` (base64 PKCS#12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`. These follow the same secret names as ovim and clawtab. Credentials belong in GitHub Actions secrets, never in the repository or logs.

## Custom output folder

`BMUX_OUTPUT_DIR` chooses the folder containing `bmux.app`. Relative paths resolve from the checkout.

```sh
BMUX_OUTPUT_DIR="$HOME/workspace/_tools" pnpm package
```

Use the same signing identity for each installed build so macOS recognizes updates as the same application and preserves Keychain access. Other files in that folder are preserved. Keep `BMUX_OUTPUT_DIR` set when using the CLI, or point `BMUX_APP` at the bundle:

```sh
export BMUX_APP="$HOME/workspace/_tools/bmux.app"
bmux attach-session -t main
```

Without an override, the CLI checks `build/bmux.app` and then `~/workspace/_tools/bmux.app`.

For zsh command hints, link the completion file from the installed app into a
directory already in your `fpath` before `compinit`. For example:

```sh
ln -s "$HOME/workspace/_tools/bmux.app/Contents/Resources/bin/_bmux" ~/.zsh/completion/_bmux
```

The completion file is part of the app bundle, so subsequent packages update
the hints. Run `bmux completions zsh` to print the script.

## Package after local merges

The repository includes a tracked `post-merge` hook that packages the primary
checkout into `~/workspace/_tools/bmux.app`. Enable it once after cloning:

```sh
pnpm hooks:install
```

Git does not enable repository-provided hooks automatically. The setting is
shared by this repository's linked worktrees, but the hook skips merges inside
task worktrees so only a merge into the primary checkout replaces the installed
application. It also skips non-macOS systems and never restarts a running app.

Set `BMUX_OUTPUT_DIR` to change the installation folder. Set
`BMUX_SKIP_POST_MERGE_PACKAGE=1` for a merge that should not create a package.

## Verification

Run `pnpm test:package` after packaging.

To check a release DMG and its adjacent updater ZIP without launching them:

```sh
bash scripts/verify-macos-dmg.sh release/bmux-0.1.5-arm64.dmg arm64
```

The Release workflow also accepts `verify_only=true` with an existing version tag. This builds and tests both macOS architectures from the selected workflow ref without uploading release assets or changing Homebrew.

On the native runner architecture, release CI starts the signed package three
times with separate disposable profiles. Each smoke run uses the CLI shipped
inside the bundle and checks background automation, plugins, and client
attachment/detachment. A failure stops publication without retries. Failed
runs retain client startup logs, a main-process sample, and macOS crash reports
in the `macos-smoke-ARCH` artifact. Set `BMUX_TRACE_CLIENT_STARTUP=1` to log
window creation, renderer loading, and Dock activation when diagnosing a
startup hang.
