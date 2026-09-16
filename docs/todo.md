# Development backlog

This list tracks follow-up work from the current implementation and documented
limitations.

## Next: everyday browsing

These are proposed additions, ordered by priority. Keep controls keyboard
accessible and use the existing address bars and transient panels.

- [ ] Show connection security beside each pane's address. Use a lock icon only
  for a verified encrypted connection, with distinct states for HTTP, certificate
  errors, mixed content, loading/unknown, and local/internal pages. Derive the
  state from Chromium's connection information, not just the URL scheme; clear
  stale state on navigation and keep it scoped to the correct pane.
- [ ] Open a site-information panel from the connection indicator or a command.
  Show the current origin, connection status, certificate subject, issuer, and
  validity dates when available. Explain that encryption does not establish
  website trustworthiness. Keep certificate failures blocked by default. Verify
  valid, expired, self-signed, and hostname-mismatched certificates with local
  fixtures in Tart, including redirects and switching panes.
- [ ] Review and reset saved site permissions in the site-information panel.
  Show existing allow/deny decisions for the current origin and profile, and
  let users return a decision to ask-on-next-request.
- [ ] Clear the current site's cookies and storage without clearing the whole
  profile. Explain the sign-out effect, confirm the affected site/profile, and
  offer a reload after completion.
- [ ] Add a searchable history panel using the existing per-profile visit data.
  Search titles and URLs, open results with the keyboard, and support deleting
  individual entries or clearing that profile's history.
- [x] Create and update bookmarks from bmux with Command+D, folder selection,
  duplicate handling within a profile, and preserved imported folder structure.
- [ ] Delete bookmarks from bmux.

## After that

- [ ] Remember page zoom per site and profile, with a visible reset action and
  consistent behavior for newly opened panes at the same site.
- [ ] Offer temporary profiles for short browsing sessions. Keep their cookies,
  history, permissions, and saved forms out of persistent profiles; define when
  data is discarded and explain that downloaded files remain on disk.

Connection indicator background: Chromium's
[HTTPS indicator research](https://blog.chromium.org/2021/07/increasing-https-adoption.html)
explains why the lock must describe connection security rather than site trust.

## Completed

- [x] Add a profile-scoped download manager with byte progress, known/unknown
  totals, pause/resume where supported, cancellation, and guarded Show in Finder.
  Expose it through command search, activity, configurable shortcuts, an active
  transfer indicator, and CLI commands. Verify real transfers, resumable
  interruptions, missing files, and profile isolation in Tart. The list is
  process-local; downloaded files persist on disk.

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
  the [repeatable Tart setup](bitwarden-desktop-test.md).
- [x] Stabilize native focus checks in full Tart runs. Preserve current-client
  page/prompt focus during activation, wait for the fixture's own control socket
  and completed native handoffs, and send keys after confirming their focused
  owner. Two consecutive full passes succeeded with all focus, attachment, and
  background-automation assertions retained.
- [x] Extend cosmetic ad hiding into nested, cross-origin, and sandboxed frames,
  with live scope changes, navigation cleanup, and page policies preserved.
- [x] Add name search to the session picker.
- [x] Add bookmark search while preserving profile scope and folder context.
- [x] Show find-in-page match counts and support previous matches in the prompt,
  independently of pending agent waits.
- [x] Add CLI selector waits for attached, detached, visible, and hidden states,
  with validation and background-tab coverage.
- [x] Refresh `verification.md` and document browser-tool and command-search coverage.
- [x] Add fuzzy command search and slash search in help.
- [x] Add ad blocking, Dark Reader, saved forms, Bitwarden CLI filling, and userscripts.
- [x] Add local script plugins and page hooks.

Chrome extensions, external browser embedding, and cloud synchronization remain
outside the current scope; see [README.md](../README.md#current-boundaries).
