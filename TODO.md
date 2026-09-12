# Development backlog

This list tracks follow-up work from the current implementation and documented
limitations.

## Browser tools

- [ ] Verify the experimental Bitwarden desktop integration with a disposable vault:
  pairing approval, locked/unlocked state, and filling a local fixture. This requires
  a disposable desktop setup; see the [experiment's verification notes](examples/plugins/experimental.bitwarden/README.md#protocol-evidence-and-verification).

## Completed

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
