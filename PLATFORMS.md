# Platform notes

bmux uses Electron and is intended to run across desktop platforms. Development starts with the same commands:

```sh
pnpm install
pnpm dev
```

## macOS

Building the native pointer integration requires Xcode Command Line Tools. Application state defaults to `~/Library/Application Support/bmux`.

The current `pnpm package` script produces an unsigned `.app` bundle. Local GUI tests use a Tart virtual machine. See [Packaging](PACKAGING.md) and [the Tart test setup](docs/tart-tests.md).

Default direct shortcuts use Command. Change them in [keyboard configuration](KEYBOARD.md#configuration).

## Linux and Windows

Run bmux from source with `pnpm dev`. Platform-specific installers aren't configured in this repository yet. Direct shortcuts can be changed in [keyboard configuration](KEYBOARD.md#configuration).
