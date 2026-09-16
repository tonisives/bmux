# Browser extensions (experimental)

Extensions are installed separately in each bmux browser profile. Installation
grants the extension its manifest permissions for that profile. Install only
extensions you trust. They run in sandboxed extension contexts; websites do not
receive the bmux API.

Open the command prompt and run:

```text
extension install-bitwarden
extension open Bitwarden
```

The installer downloads the official Bitwarden 2026.6.1 Chrome release from
GitHub and verifies its pinned SHA-256 checksum before extraction. This is the
last known-good release before a Bitwarden 2026.7–2026.8 WASM decryption
regression that can leave a successfully synced vault empty. Sign in using
Bitwarden's own popup. The extension manages its own vault session. Extension updates are manual in this prototype.

After installation, reload existing login pages so the extension can inject its
content scripts. Bitwarden provides the passkey UI; this does not add Chrome's
phone QR chooser to Electron. Vault authentication and passkey signing require
a manual check with your account; the automated smoke test stops at Bitwarden's
email login screen and does not access a real vault.
Bitwarden registers its passkey scripts only after an account is signed in.
For the first manual check, sign in with email and master password, unlock the
vault, reload the website, and choose that website's passkey sign-in option.

For other unpacked extensions, use `extension load /absolute/path`. The directory
must contain `manifest.json` and remain at that path between launches. Packaged
CRX files are not supported. To remove an extension, use `extension remove ID`.
Unloading stops the extension but retains its browser storage; reload open pages
to remove scripts it has already injected.

The CLI exposes the same operations with an explicit profile:

```sh
bmux extension install-bitwarden --profile profile_default
bmux extension list --profile profile_default
bmux extension open Bitwarden --profile profile_default
bmux extension remove EXTENSION_ID --profile profile_default
```

`extension list` reports loaded extensions and any restoration failures. Loading
successfully does not guarantee compatibility with all Chrome APIs. Optional
permission requests are declined. Native desktop integration, biometrics,
extension shortcuts, the side panel, and store updates are not implemented.

## Compatibility and licensing

The prototype uses `electron-chrome-extensions` 4.9.0 under GPL-3.0, with a pnpm
patch for `chrome.storage.session`, event cleanup, and removal of API argument
and result logging. Session storage is memory-only, scoped to each extension
and profile, restricted to extension pages/workers, and cleared on unload or
exit. It is never substituted with disk-backed `storage.local`.

The browser is distributed under GPL-3.0-only. The private website repository is
outside this change. The previous MIT copyright and permission notice is retained
in `LICENSE-MIT`.

References: [Electron extension support](https://www.electronjs.org/docs/latest/api/extensions),
[compatibility library](https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/electron-chrome-extensions),
[Bitwarden release](https://github.com/bitwarden/clients/releases/tag/browser-v2026.6.1).
