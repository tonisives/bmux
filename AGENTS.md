# bmux development

- Use pnpm and a local `.worktrees` implementation branch. Commit, merge locally, and clean up completed worktrees.
- No emojis in code, documentation, or UI.
- Follow the user's React style guide: functional arrow components, types rather than interfaces, named exports, `let` for local declarations, CSS modules, context for shared state.
- Keep browser pages sandboxed and without privileged preload code.
- Profile IDs, session IDs, window IDs, pane IDs, and tab IDs are separate identities. A profile is fixed per pane.
- Browser operations must not activate the app or change a client's selection unless the command explicitly requests that behavior.
- Run BMUX tests in GitHub Actions, including unit, Electron, UI and package smoke tests. Do not run local test suites or start a separate test VM.
- Merge locally to main, keep the post-merge packaging hook, push main and wait for the Check workflow on that exact merged SHA. Record the final conclusion and run URL; queued, cancelled or older runs are not verification. Fix CI failures before calling the work complete.
- For focused CI investigation, use workflow_dispatch with test_pattern; use visual_check for browser rendering changes and repeat_each for a reproduced timing or focus failure. See docs/test-reliability.md.
- GUI tests must establish their own window/pane selection and wait for completed scrolling, renderer updates, and native view attachment. Poll observable results instead of relying on fixed sleeps before native screenshots.
- Use `closeTestApplication` from `tests/electron-fixture.ts` for disposable Electron shutdown and restarts. It bounds graceful shutdown and waits for process exit before profile cleanup, so renderer teardown cannot mask failed assertions or stall CI.
- Changes to remote control, Linux hosts, or container packaging must also pass the `Portable hosts` workflow on the implementation branch via `workflow_dispatch` before merging.
- GitHub Actions runs GUI tests on its disposable macOS desktop. Local test commands reject execution; BMUX_TEST_NATIVE is not a host bypass. The shared build queue is the only local VM owner. See docs/tart-tests.md.
- Tests must use disposable `BMUX_DATA_DIR` directories and local fixture pages. Never read a real browser profile or print secrets.
- Windows startup tests run on the disposable Windows workflow desktop via `pnpm test:windows`, separate from the main suite. See `docs/windows-tests.md`; release installers must pass this suite before publication.
- Use asynchronous child-process APIs for CLI calls in GUI tests that also host HTTP fixtures, including expected-denial checks, so navigation can finish while the CLI waits.
- Frontend development uses hot reload. Avoid restarting the browser just for renderer edits.
- Packaging defaults to `build/bmux.app`; use `BMUX_OUTPUT_DIR` to choose another folder. On this Mac, install verified builds to `~/workspace/_tools/bmux.app` (`/Users/tonis/workspace/_tools/bmux.app` on this Mac) using `BMUX_OUTPUT_DIR="$HOME/workspace/_tools" pnpm package`. Keep the source repository here. Do not restart a running app after packaging.
- Keep the persistent UI to page content and one tmux-style status bar. Use transient command prompts and shortcut panels for controls.
- Use the shared `panelTabs` style for all panel tabs, matching the general settings tabs.
- Verify browser behavior and UI changes in GitHub Actions; use the visual_check dispatch input when address-bar/native page rendering verification is relevant.
- Keyboard preferences live in `~/.config/bmux/config.yaml` and reload live; preserve existing user edits. Test instances must use isolated config files.
- Never block view attachment/detachment or human shortcuts on navigation, screenshots, or agent command queues.

## Shared local builds

On this Mac, finite builds and compilation-heavy checks use the shared macOS
builder. All projects and worktrees share one queue, three CPUs and 8 GB RAM.
Use the packaging targets that call `scripts/build-local.py`, or run
`~/.agents/scripts/buildctl run --prepare-node -- pnpm build` from the
project directory. Do not start a second build directly on the host.

Source snapshots include working edits. Compiler and package caches persist
inside the worker. Signing and installation stay on the host; development
servers and running apps keep their existing lifecycle. CI and commands
already inside the worker run normally. If the configured service is stopped,
fix it rather than falling back to host compilation.
See `~/.agents/scripts/build-service.md` for outputs, cancellation and setup.
