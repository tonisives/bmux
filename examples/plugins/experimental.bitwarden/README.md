# Bitwarden desktop experiment

This optional plugin tests direct communication with Bitwarden's desktop app,
using the native protocol behind its DuckDuckGo integration. It is not an official
Bitwarden integration and is disabled until explicitly enabled in bmux config.

The plugin offers `status` (pair and check lock state) and `fill` (pair, retrieve
URL-matched logins, choose one, fill visible main-frame fields). Each invocation
generates a fresh RSA keypair, asks the desktop app to approve **bmux**, and keeps
its shared key only in process memory. It does not use the Bitwarden CLI.

## Requirements and limitations

- macOS with Node.js and Bitwarden desktop running. Unlock its active account and
  enable **Allow DuckDuckGo browser integration** in the desktop settings.
- Default proxy: `/Applications/Bitwarden.app/Contents/MacOS/desktop_proxy`.
  `BMUX_BITWARDEN_PROXY` can point to a development/test proxy.
- Bitwarden's current handler stores a single DuckDuckGo shared key. Pairing bmux
  can invalidate an existing DuckDuckGo connection. The plugin confirms this
  before every experiment. Use a disposable desktop vault for testing.
- The desktop app may come forward to request pairing approval. After approval,
  return to the same bmux tab; the plugin waits before opening its login picker.
- Reconnection requires approval again. No persistent key storage, writes to the
  vault, automatic filling, passkeys, TOTP, or cross-origin frame filling.
- Fill recognizes one visible password field and an optional preceding username
  in the same form. It does not submit. HTTP pages require explicit confirmation.
  Changed documents, ambiguous password fields, and hidden fields are rejected.

## Protocol evidence and verification

Reviewed upstream `main` on 2026-09-11:

- [Desktop handshake handler](https://github.com/bitwarden/clients/blob/main/apps/desktop/src/services/duckduckgo-message-handler.service.ts): application name comes from the request, approval is explicit, and the shared key is global to the DuckDuckGo integration.
- [Command handler](https://github.com/bitwarden/clients/blob/main/apps/desktop/src/services/encrypted-message-handler.service.ts): status and URL retrieval operate on the desktop's active account.
- [Test-runner transport](https://github.com/bitwarden/clients/blob/main/apps/desktop/native-messaging-test-runner/src/ipc.service.ts): the proxy uses length-prefixed UTF-8 JSON over stdio.

Implemented protocol version 1, RSA-OAEP-SHA1 handshake (required by upstream),
AES-256-CBC with HMAC-SHA256, null-padded requests, and PKCS7-padded responses.
Tests use an independent mock peer for encryption, handshake, status, and lookup;
framing tests cover chunking and UTF-8, and tampered MACs are rejected.

Live verification passed on **2026-09-12** with official desktop **2026.8.0** in
Tart, Vaultwarden **1.37.2**, and web vault **2026.7.0**. The check creates a random
disposable account, saves one local login, enables DuckDuckGo integration, and
approves the desktop's bmux pairing request for each invocation. Status reports
`unlocked`, then `locked` after the native lock command. After unlocking, filling
requires the HTTP confirmation and login selection; the visible native page
receives the expected credentials without submitting the form.

The live run exposed a response-format mismatch: Electron IPC strips the
`EncString` prototype, so the desktop proxy returns an object containing
`encryptedString`. The plugin accepts that object and the string representation,
and authenticates either through the same HMAC check. Independent mock-peer
regressions cover both representations.

See the [disposable Tart setup](../../../notes/bitwarden-desktop-test.md) to repeat
the check. Evidence is in `artifacts/tart/2026-09-12T11-19-19.762Z/`, including a
sanitized JSON result and a screenshot with the input values masked. No personal
vault was read. This remains an unofficial, opt-in experiment with the pairing
limitations above.
