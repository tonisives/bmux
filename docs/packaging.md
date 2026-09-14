# Packaging

The current packaging command builds the app and installs the finished bundle in `build/bmux.app`:

```sh
pnpm package
```

The command replaces the previous bundle only after the new build succeeds. It doesn't restart a running app. The `release/` directory is temporary packaging output.

The package step signs with bmux's Developer ID identity when it is installed in Keychain and verifies the complete bundle after installation. Set `BMUX_SIGNING_IDENTITY` to use another certificate hash. Builds without the bmux identity remain local unsigned builds and are not notarized. See [Platform notes](platforms.md) for host requirements and the status of other platforms.

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

## Verification

Run `pnpm test:package` after packaging. See [Local verification](verification.md) for the full test setup and current results.
