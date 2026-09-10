# Local verification

Validated on macOS, Apple Silicon, with Electron 44.3.0 and Node.js 24.18.0.

- `pnpm check`: TypeScript, React ESLint rules, and four model/persistence tests.
- `pnpm test:electron`: two integration scenarios using disposable profile directories and local HTTP fixtures.
- `pnpm package`: local unsigned macOS application bundle installed at `~/workspace/_tools/Browmux.app`.
- `pnpm test:package`: public CLI against the packaged executable, including silent startup, keyboard input, DOM extraction, full-page PNG capture, unchanged macOS focus, and client attachment/detachment.

Integration coverage includes isolated and shared profile storage, retained JavaScript and form state across native view handoffs, independent client selections, captured previews, layout restoration, background automation, popup profile/opener behavior, persistence after restart, permissions, downloads, renderer recovery, and pane cleanup.

The tests save `artifacts/client.png` for visual review and `artifacts/resource-sample.json` for a short idle sample. An eight-tab run with no clients open measured approximately 1.1 GB summed process working sets and 0.15% CPU. Working sets can double-count shared memory. This fixture sample is not a benchmark against another browser or a prediction for complex websites.

The build uses Electron's default icon and is unsigned. Extensions and external browser embedding are excluded. JavaScript alert/confirm/prompt dialogs are disabled. See README for other current boundaries.
