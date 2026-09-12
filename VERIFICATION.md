# Local verification

Validated on macOS, Apple Silicon, with Electron 44.3.0 and Node.js 24.18.0.

- `pnpm check`: TypeScript, React ESLint rules, and unit tests for models, persistence, import, commands, config, browser tools, plugins, picker search, wait validation, and the Tart runner.
- `pnpm test:electron`: integration scenarios using disposable profile directories and local HTTP fixtures in the Tart macOS VM.
- `pnpm test:ui`: types a real URL and submits Enter, checks visible native page bounds, and saves a screenshot. `pnpm debug:ui` leaves the isolated debug instance open.
- `pnpm package`: local unsigned macOS application bundle installed at `~/workspace/_tools/bmux.app`.
- `pnpm test:package`: public CLI against the packaged executable, including silent startup, keyboard input, DOM extraction, full-page PNG capture, unchanged macOS focus, and client attachment/detachment.

Integration coverage includes isolated and shared profile storage, retained JavaScript and form state across native view handoffs, independent client selections, captured previews, layout restoration, background automation, popup profile/opener behavior, persistence after restart, permissions, downloads, renderer recovery, pane cleanup, and Brave bookmark import/opening/restart using fixture profiles.

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

The build uses the Little Lantern bmux icon and is unsigned. Extensions and external browser embedding are excluded. JavaScript alert/confirm/prompt dialogs are disabled. See README for other current boundaries.

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

Accessibility coverage checks live configuration, invalid-edit recovery, startup persistence, and custom Command+bracket window switching. Native oVim validation uses the running app with its existing macOS accessibility permission: at depth 30, enabling bmux accessibility increased Grafana detection from six to seventeen elements. The installed build also detected seventeen Grafana elements with accessibility enabled solely through its startup config. Direct helper invocations from an untrusted terminal can return empty results and are not a valid native accessibility check.
