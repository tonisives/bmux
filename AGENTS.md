# bmux development

- Use pnpm and a local `.worktrees` implementation branch. Commit, merge locally, and clean up completed worktrees.
- No emojis in code, documentation, or UI.
- Follow the user's React style guide: functional arrow components, types rather than interfaces, named exports, `let` for local declarations, CSS modules, context for shared state.
- Keep browser pages sandboxed and without privileged preload code.
- Profile IDs, session IDs, window IDs, pane IDs, and tab IDs are separate identities. A profile is fixed per pane.
- Browser operations must not activate the app or change a client's selection unless the command explicitly requests that behavior.
- Use `pnpm check`, `pnpm test:electron`, and `pnpm package`. Limit worker concurrency to four.
- Local GUI tests (`test:electron`, `test:ui`, `debug:ui`, and `test:package`) must run through the Tart runner. Its macOS VM viewer belongs on AeroSpace workspace `bot`; Tart and VM storage live under `/Volumes/sam`. See `docs/tart-tests.md`. Never bypass this with direct Playwright/Electron launches or `BMUX_TEST_NATIVE=1` on the working desktop. GitHub Actions uses its own disposable macOS desktop.
- Tests must use disposable `BMUX_DATA_DIR` directories and local fixture pages. Never read a real browser profile or print secrets.
- Frontend development uses hot reload. Avoid restarting the browser just for renderer edits.
- Packaging defaults to `build/bmux.app`; use `BMUX_OUTPUT_DIR` to choose another folder. On this Mac, install verified builds to `~/workspace/_tools/bmux.app` (`/Users/tonis/workspace/_tools/bmux.app` on this Mac) using `BMUX_OUTPUT_DIR="$HOME/workspace/_tools" pnpm package`. Keep the source repository here. Do not restart a running app after packaging.
- Keep the persistent UI to page content and one tmux-style status bar. Use transient command prompts and shortcut panels for controls.
- Always verify UI changes by typing a real URL and pressing Enter (`pnpm test:ui`), checking visible native page rendering. Debug instances must use separate temporary profiles (`pnpm debug:ui`).
- Keyboard preferences live in `~/.config/bmux/config.yaml` and reload live; preserve existing user edits. Test instances must use isolated config files.
- Never block view attachment/detachment or human shortcuts on navigation, screenshots, or agent command queues.
