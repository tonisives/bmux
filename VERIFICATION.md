# Local verification

Validated on macOS, Apple Silicon, with Electron 44.3.0 and Node.js 24.18.0.

- `pnpm check`: TypeScript, React ESLint rules, and unit tests for models, persistence, import, commands, config, browser tools, plugins, picker search, wait validation, and the Tart runner.
- `pnpm test:electron`: integration scenarios using disposable profile directories and local HTTP fixtures in the Tart macOS VM.
- `pnpm test:ui`: types a real URL and submits Enter, checks visible native page bounds, and saves a screenshot. `pnpm debug:ui` leaves the isolated debug instance open.
- `pnpm package`: local unsigned macOS application bundle installed at `~/workspace/_tools/bmux.app`.
- `pnpm test:package`: public CLI against the packaged executable, including silent startup, keyboard input, DOM extraction, full-page PNG capture, unchanged macOS focus, and client attachment/detachment.

Integration coverage includes isolated and shared profile storage, retained JavaScript and form state across native view handoffs, independent client selections, captured previews, layout restoration, background automation, popup profile/opener behavior, persistence after restart, permissions, downloads, renderer recovery, pane cleanup, and Brave bookmark import/opening/restart using fixture profiles.

Local GUI checks run through the [Tart runner](docs/tart-tests.md), which keeps focus and pointer changes inside the guest. Results and screenshots are copied to `artifacts/tart/<run-time>/`. Tests save `artifacts/client.png` for visual review and `artifacts/resource-sample.json` for a short idle sample inside that run. An earlier eight-tab run with no clients open measured approximately 1.1 GB summed process working sets and 0.15% CPU. Working sets can double-count shared memory. This fixture sample is not a benchmark against another browser or a prediction for complex websites.

The build uses the Little Lantern bmux icon and is unsigned. Extensions and external browser embedding are excluded. JavaScript alert/confirm/prompt dialogs are disabled. See README for other current boundaries.

The URL regression test imports profiles while existing pages are live, submits a URL through the interface, and checks that the page is attached to a visible native window. It also sends Command+L and prefix/help keystrokes to the actual page WebContents and checks command errors. The import fix preserves object identity for existing live tab callbacks.

Stalled-load coverage holds a script response indefinitely and verifies prefix commands, reload, window isolation, nonblocking switches, cancellation of a pending agent navigation, live YAML remapping, and recovery from invalid YAML. The installed build was checked anonymously at the requested Grafana login URL with its password field visible, then a second internal window opened example.com. Both retained distinct URLs and switching back restored the Grafana native view; no sign-in was attempted. Native GUI checks explicitly activate their disposable client because macOS focus changes park page views by design.

Keyboard management coverage includes native prefix shortcuts for window/session renaming, close cancellation and confirmation, last-window replacement, session-picker focus and arrow movement, Enter/Escape selection behavior, direct session cycling, and Command+Shift+W detaching while retaining the session.

Command and picker coverage includes fuzzy command selection, completion, history, enabled plugin actions, slash search in help, title/URL tab search, session-name search, and profile-scoped bookmark search with folder context and unsupported URL handling. Selection tests check the focused native page after Enter and verify that filtering alone does not switch it. Screenshots include `tab-search.png` and `bookmark-search.png`.

Find coverage checks match counts, forward/backward wrapping, no matches, clearing highlights, tab isolation, and refresh after navigation. A pending CLI wait runs on the same tab while the test exercises native Command+F and the prompt; `find-counts.png` records its appearance. Public CLI tests distinguish attached, detached, visible, and hidden elements in background tabs, including offscreen content, quoted selectors, invalid requests, and unchanged client selections.

Browser-tool coverage uses local filter lists, userscripts/styles, form fixtures, and fake Bitwarden CLI responses. Tests exercise ad blocking and cosmetic selectors, Dark Reader settings, encrypted saved forms, password suggestions, unlock/session expiry, cancellation, and profile/tab isolation. This does not validate the experimental desktop pairing protocol against a live vault; its remaining setup and evidence are recorded in the [experimental plugin notes](examples/plugins/experimental.bitwarden/README.md#protocol-evidence-and-verification).

Accessibility coverage checks live configuration, invalid-edit recovery, startup persistence, and custom Command+bracket window switching. Native oVim validation uses the running app with its existing macOS accessibility permission: at depth 30, enabling bmux accessibility increased Grafana detection from six to seventeen elements. The installed build also detected seventeen Grafana elements with accessibility enabled solely through its startup config. Direct helper invocations from an untrusted terminal can return empty results and are not a valid native accessibility check.
