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

Installed desktop version observed: **2026.8.0**. Live pairing and credential
retrieval against that build are **not verified**: no disposable logged-in desktop
vault was provided, and the user's personal vault was not queried. Passing mock
tests establishes wire behavior, not compatibility with the installed desktop
proxy's OS/process checks. A live test should record desktop version, setup,
approval behavior, locked/unlocked results, and a fill into a local fixture using
disposable credentials. The bmux plugin foundation does not depend on that result.
