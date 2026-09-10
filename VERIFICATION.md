# Local verification

Validated on macOS, Apple Silicon, with Electron 44.3.0 and Node.js 24.18.0.

- `pnpm check`: TypeScript, React ESLint rules, and eleven model/persistence/import/command/config tests.
- `pnpm test:electron`: six integration scenarios using disposable profile directories and local HTTP fixtures.
- `pnpm test:ui`: types a real URL and submits Enter, checks visible native page bounds, and saves a screenshot. `pnpm debug:ui` leaves the isolated debug instance open.
- `pnpm package`: local unsigned macOS application bundle installed at `~/workspace/_tools/Browmux.app`.
- `pnpm test:package`: public CLI against the packaged executable, including silent startup, keyboard input, DOM extraction, full-page PNG capture, unchanged macOS focus, and client attachment/detachment.

Integration coverage includes isolated and shared profile storage, retained JavaScript and form state across native view handoffs, independent client selections, captured previews, layout restoration, background automation, popup profile/opener behavior, persistence after restart, permissions, downloads, renderer recovery, pane cleanup, and Brave bookmark import/opening/restart using fixture profiles.

The tests save `artifacts/client.png` for visual review and `artifacts/resource-sample.json` for a short idle sample. An eight-tab run with no clients open measured approximately 1.1 GB summed process working sets and 0.15% CPU. Working sets can double-count shared memory. This fixture sample is not a benchmark against another browser or a prediction for complex websites.

The build uses Electron's default icon and is unsigned. Extensions and external browser embedding are excluded. JavaScript alert/confirm/prompt dialogs are disabled. See README for other current boundaries.

The URL regression test imports profiles while existing pages are live, submits a URL through the interface, and checks that the page is attached to a visible native window. It also sends Command+L and prefix/help keystrokes to the actual page WebContents and checks command errors. The import fix preserves object identity for existing live tab callbacks.

Stalled-load coverage holds a script response indefinitely and verifies prefix commands, reload, window isolation, nonblocking switches, cancellation of a pending agent navigation, live YAML remapping, and recovery from invalid YAML. The installed build was checked anonymously at the requested Grafana login URL with its password field visible, then a second internal window opened example.com. Both retained distinct URLs and switching back restored the Grafana native view; no sign-in was attempted. Native GUI checks explicitly activate their disposable client because macOS focus changes park page views by design.

Keyboard management coverage includes native prefix shortcuts for window/session renaming, close cancellation and confirmation, last-window replacement, session-picker focus and arrow movement, Enter/Escape selection behavior, direct session cycling, and Command+Shift+W detaching while retaining the session.
