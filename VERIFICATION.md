# Local verification

Validated on macOS, Apple Silicon, with Electron 44.3.0 and Node.js 24.18.0.

- `pnpm check`: TypeScript, React ESLint rules, and unit tests for models, persistence, import, commands, config, browser tools, plugins, picker search, wait validation, and the Tart runner.
- `pnpm test:electron`: integration scenarios using disposable profile directories and local HTTP fixtures in the Tart macOS VM.
- `pnpm test:ui`: types a real URL and submits Enter, checks visible native page bounds, and saves a screenshot. `pnpm debug:ui` leaves the isolated debug instance open.
- `pnpm package`: local macOS application bundle installed at `~/workspace/_tools/bmux.app`; the package step uses and verifies the bmux Developer ID identity when present.
- `pnpm test:package`: public CLI against the packaged executable, including silent startup, keyboard input, DOM extraction, full-page PNG capture, unchanged macOS focus, and client attachment/detachment.

Integration coverage includes isolated and shared profile storage, retained JavaScript and form state across native view handoffs, independent client selections, captured previews, layout restoration, background automation, popup profile/opener behavior, persistence after restart, permissions, downloads, renderer recovery, pane cleanup, and Brave bookmark import/opening/restart using fixture profiles.

Download-manager coverage (`tests/downloads.electron.test.ts`) uses local HTTP
transfers to verify byte progress, pause/resume/cancel, completion, resumable
interruptions, missing-file errors, profile filtering, and CLI profile guards.
The September 14 implementation passed this targeted Tart test, `pnpm test:ui`,
all 111 unit tests with type/lint checks, and macOS packaging.

Local GUI checks run through the [Tart runner](docs/tart-tests.md), which keeps focus and pointer changes inside the guest. Results and screenshots are copied to `artifacts/tart/<run-time>/`. Tests save `artifacts/client.png` for visual review and `artifacts/resource-sample.json` for a short idle sample inside that run. An earlier eight-tab run with no clients open measured approximately 1.1 GB summed process working sets and 0.15% CPU. Working sets can double-count shared memory. This fixture sample is not a benchmark against another browser or a prediction for complex websites.

The September 12 native-focus follow-up passed two consecutive full Tart suites
(`pnpm test:electron --repeat-each=2 --max-failures=1 --trace=retain-on-failure`):
112 tests passed in 3.3 minutes. `pnpm check` passed all 94 unit tests. Activating
the current foreground client now preserves its page, caret, and plugin prompt.
The test harness waits for its own server socket before using the auto-starting
CLI, waits for native view attachment before reversing a handoff, and checks
the focused window and key recipient together before sending native input.
Focus, attachment, pointer movement, and background-automation assertions remain
in place. Failure diagnostics record routing IDs and event types without key text.
The passing full-run evidence is in `artifacts/tart/2026-09-12T08-18-02.547Z/`;
the URL/Enter and independent-pane UI check passed separately.

The build uses the Little Lantern bmux icon and uses the bmux Developer ID identity when it is available. Extensions and external browser embedding are excluded. JavaScript alert/confirm/prompt dialogs are disabled. See README for other current boundaries.

The URL regression test imports profiles while existing pages are live, submits a URL through the interface, and checks that the page is attached to a visible native window. It also sends Command+L and prefix/help keystrokes to the actual page WebContents and checks command errors. The import fix preserves object identity for existing live tab callbacks.

Stalled-load coverage holds a script response indefinitely and verifies prefix commands, reload, window isolation, nonblocking switches, cancellation of a pending agent navigation, live YAML remapping, and recovery from invalid YAML. The installed build was checked anonymously at the requested Grafana login URL with its password field visible, then a second internal window opened example.com. Both retained distinct URLs and switching back restored the Grafana native view; no sign-in was attempted. Native GUI checks explicitly activate their disposable client because macOS focus changes park page views by design.

Keyboard management coverage includes native prefix shortcuts for window/session renaming, close cancellation and confirmation, last-window replacement, session-picker focus and arrow movement, Enter/Escape selection behavior, direct session cycling, and Command+Shift+W detaching while retaining the session.

Command and picker coverage includes fuzzy command selection, completion, history, enabled plugin actions, slash search in help, title/URL tab search, session-name search, and profile-scoped bookmark search with folder context and unsupported URL handling. Selection tests check the focused native page after Enter and verify that filtering alone does not switch it. Screenshots include `tab-search.png` and `bookmark-search.png`.

Find coverage checks match counts, forward/backward wrapping, no matches, clearing highlights, tab isolation, and refresh after navigation. A pending CLI wait runs on the same tab while the test exercises native Command+F and the prompt; `find-counts.png` records its appearance. Public CLI tests distinguish attached, detached, visible, and hidden elements in background tabs, including offscreen content, quoted selectors, invalid requests, and unchanged client selections.

Browser-tool coverage uses local filter lists, userscripts/styles, form fixtures, and fake Bitwarden CLI responses. Tests exercise ad blocking and cosmetic selectors, Dark Reader settings, encrypted saved forms, password suggestions, unlock/session expiry, cancellation, and profile/tab isolation.

The separate live desktop check passed with Bitwarden 2026.8.0 and a disposable
Vaultwarden 1.37.2 account in Tart. It verifies explicit pairing, unlocked and
locked status, a fresh pairing after the desktop replaces its renderer on lock,
HTTP confirmation, login selection, and filling a visible local native page
without submission. The released desktop's serialized encrypted-response object
is covered by the protocol regression; `pnpm check` now passes 95 unit tests.
See the [experimental plugin notes](examples/plugins/experimental.bitwarden/README.md#protocol-evidence-and-verification)
and [repeatable setup](docs/bitwarden-desktop-test.md). Sanitized evidence is in
`artifacts/tart/2026-09-12T11-19-19.762Z/`.
The final integration run passed all 56 tests in 1.7 minutes
(`artifacts/tart/2026-09-12T11-21-49.878Z/`), and packaging installed the build at
`~/workspace/_tools/bmux.app` without restarting it.

Frame cosmetics coverage forces separate renderer processes and checks nested
cross-origin frames, script-disabled sandbox frames, `srcdoc`, `about:blank`,
strict CSP, host-specific rules, dynamic content, process swaps, and frame removal.
Live site/profile changes also cover background tabs during a pending agent wait,
with unchanged client selections and native focus. Assertions use Electron's frame
tree and frame locators for script-disabled documents; a screenshot is saved as
`frame-cosmetics.png`. Unit checks cover stale document work, transient failures,
stylesheet cleanup, unrelated targets, and disposal.

Accessibility coverage checks live configuration, invalid-edit recovery, startup persistence, and custom Command+bracket window switching. Enabling accessibility increased native Grafana element detection from six to seventeen elements in the installed build. Direct helper invocations from an untrusted terminal can return empty results and aren't a valid native accessibility check.


The September 13 password-popup follow-up covers app hiding/reactivation while
an unlock form contains input, restoration of the popup's native keyboard focus,
and selecting a login after the original username field loses DOM focus. A
separate plugin test retains a private password prompt through the same app
switch. Discovery pauses while the popup owns focus; explicit actions validate
the original document and field, and background actions cannot fill credentials.
These regressions use disposable local fixtures, not a live X.com account.

Validation: `pnpm check` passed 99 tests. The full Tart run passed 56 of 58
cases; the remaining cases passed targeted reruns after correcting the default
window-shortcut test and retrying an unrelated Electron teardown timeout in the
frame fixture. All four frame cases passed the rerun. Both installed-app popup
cases passed with `BMUX_TEST_INSTALLED=1`; `pnpm test:ui` passed and its native
page screenshot was reviewed. Packaging installed the app without restarting it.
Artifacts: `2026-09-12T23-55-53.604Z` (full run),
`2026-09-13T00-01-31.685Z` (frames), `2026-09-13T00-03-40.598Z` (shortcuts),
`2026-09-12T23-53-20.649Z` (installed popup), and
`2026-09-12T23-53-42.166Z` (URL entry), under `artifacts/tart/`.


The second September 13 defocus follow-up fixes a discovery race: an inspection
started in the foreground could finish in the background and clear the popup.
Background discovery now pauses without clearing existing UI, and the native
poller no longer treats a temporarily missing web first responder as dismissal.
Navigation, field changes, explicit dismissal, and foreground fill checks remain.
The new unit regression failed before the fix and passed afterward. `pnpm check`
passed all 101 tests. The browser-tools Tart run passed its existing 25 cases;
the expanded app-switching test passed a targeted rerun after adding a wait for
the initial popup before switching windows. That test checks a visible competing
window, app hiding with partial password input, native popup visibility and focus
restoration, and username fill after DOM blur. `pnpm test:ui` passed and the native
URL-entry screenshot was reviewed. All pages and credentials were disposable
fixtures. Artifacts: `2026-09-13T00-36-27.801Z`,
`2026-09-13T00-37-33.543Z`, and `2026-09-13T00-37-16.508Z`.


September 13 visible-page ownership follow-up: native views remain attached to
visible, non-minimized clients when bmux loses focus. Each page prefers its
focused viewer, then its existing visible viewer, then another eligible viewer.
Independent windows can display live pages together; shared pages still transfer
without reloading. Background bounds updates and visibility changes reconcile
ownership. Explicit activation avoids reactivating the app when it already owns
the key window, preventing an old client from reclaiming focus during handoff.

The native regressions verify two simultaneous visible page hosts, unchanged
hosts during a competing window's focus, shared-page identity and form state
through handoffs, and password popup visibility and native character/Enter input
after defocus. Macro input is simulated with disposable fixture text; the user's
Hammerspoon chooser and typing script were inspected but not executed or changed.
The targeted handoff and password cases passed; `pnpm check` passed 101 tests.
`pnpm test:ui` passed and its visible native URL-entry screenshot was reviewed.
Artifacts: `2026-09-13T06-39-07.871Z` (targeted native tests) and
`2026-09-13T06-39-31.022Z` (URL entry), under `artifacts/tart/`.

The full native suite then passed all 58 tests in one run (1.6 minutes):
`artifacts/tart/2026-09-13T06-39-44.144Z/`.


September 13 Bitwarden latency follow-up removes the pre-unlock status process
for an explicit password unlock, overlaps item lookup with status validation,
and retains popup lookup results privately for at most 30 seconds. A selected
credential is consumed once by the matching client/tab/document/profile/URL fill
within five seconds; that fill still validates vault status and account identity.
Lock, expired entries, changed accounts, and mismatched contexts require a fresh
lookup. No credentials are added to published state or persisted on disk.

A fake-timer regression with one-second CLI operations completes unlock and item
loading in two seconds instead of four sequential seconds. This measures command
scheduling, not the user's real vault or machine. Selection reuses one lookup
while still issuing a new status check. Cache expiry and account/lock invalidation
have regression coverage. `pnpm check` passed 105 tests; all 26 native browser-tool
tests passed, followed by seven popup checks after the final selection change.
`pnpm test:ui` passed and the visible native page screenshot was reviewed.
Artifacts: `2026-09-13T06-59-55.129Z`, `2026-09-13T07-01-31.100Z`, and
`2026-09-13T07-00-58.862Z`, under `artifacts/tart/`.


September 13 warm Bitwarden follow-up caches verified unlocked status and the
most recent exact-origin lookup for 30 seconds. Every reuse checks data.json
metadata (device, inode, size, modification and change timestamps) and the local
session generation. Missing/unreadable metadata disables reuse. Unlock, close,
command failure, explicit refresh, and changed metadata invalidate the cache.
Changes during a CLI command prevent its result from being cached. A popup's
selected credential also records the vault revision, so a fresh status with a
different revision forces another item lookup. Only in-memory results are cached;
there is no new secret file or local HTTP API.

CLI storage paths follow [Bitwarden's storage documentation](https://bitwarden.com/help/data-storage/)
and the [CLI app-data override](https://bitwarden.com/help/cli/). Custom executables
require an explicit app-data directory to enable caching. These tests use only
fixture CLI processes and disposable data files; no real vault was inspected.

`pnpm check` passed 110 tests, including real subprocess-count checks for warm
reuse, explicit refresh, file replacement, expiry, lock, missing files, and a
vault change during a pending request. All 27 browser-tool native tests passed,
including a complete popup selection and username fill that launches zero new
CLI processes. This removes subprocess latency from warm actions; cold unlocks,
first origin lookups, and expired/invalidated entries still use the CLI.
Native artifacts: `artifacts/tart/2026-09-13T09-18-38.261Z/`.

Final refresh/empty/failure and warm-fill reruns passed (3 tests):
`2026-09-13T09-20-25.164Z`. `pnpm test:ui` passed and its native page screenshot
was reviewed: `2026-09-13T09-19-56.923Z`.
