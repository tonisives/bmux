# Development backlog

This list tracks follow-up work from the current implementation and documented
limitations.

## Completed

- [x] Remove CLI startup from warm password selection and same-origin lookup.
  Reuse results for 30 seconds only while the CLI data file and session remain
  unchanged; invalidate on lock, refresh, expiry, and vault revision changes.

- [x] Reduce Bitwarden CLI latency: avoid the pre-unlock status process, overlap
  item loading with session checks, and reuse a short-lived selected login.

- [x] Keep live pages attached to visible windows through app defocus. Transfer
  shared pages only when another viewer needs them, and render independent
  windows simultaneously. Verify popup keyboard input after a focus handoff.

- [x] Preserve the password overlay when an in-flight field inspection finishes
  after app defocus; do not dismiss it during native focus handoffs.

- [x] Keep password popups and plugin prompts through app defocus, restore native
  password input focus, and accept popup selections after the original login
  field loses DOM focus. Preserve document, profile, and foreground fill checks.

- [x] Verify experimental Bitwarden desktop pairing, locked/unlocked state, and
  filling a visible local fixture without submission using a disposable vault.
  Fix the released desktop's serialized encrypted-response format and document
  the [repeatable Tart setup](docs/bitwarden-desktop-test.md).
- [x] Stabilize native focus checks in full Tart runs. Preserve current-client
  page/prompt focus during activation, wait for the fixture's own control socket
  and completed native handoffs, and send keys after confirming their focused
  owner. Two consecutive full passes succeeded with all focus, attachment, and
  background-automation assertions retained.
- [x] Extend cosmetic ad hiding into nested, cross-origin, and sandboxed frames,
  with live scope changes, navigation cleanup, and page policies preserved.
- [x] Add title/URL search to the tab picker and name search to the session picker.
- [x] Add bookmark search while preserving profile scope and folder context.
- [x] Show find-in-page match counts and support previous matches in the prompt,
  independently of pending agent waits.
- [x] Add CLI selector waits for attached, detached, visible, and hidden states,
  with validation and background-tab coverage.
- [x] Refresh `VERIFICATION.md` and document browser-tool and command-search coverage.
- [x] Add keyboard navigation to the tab picker, including initial active-tab focus,
  arrow keys, Home/End, PageUp/PageDown, Enter selection, Escape cancellation, and
  keyboard focus restoration after the selected page attaches.
- [x] Add fuzzy command search and slash search in help.
- [x] Add ad blocking, Dark Reader, saved forms, Bitwarden CLI filling, and userscripts.
- [x] Add local script plugins and page hooks.

Chrome extensions, external browser embedding, and cloud synchronization remain
outside the current scope; see [README.md](README.md#current-boundaries).
