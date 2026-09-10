# Browmux development

- Use pnpm and a local `.worktrees` implementation branch. Commit, merge locally, and clean up completed worktrees.
- No emojis in code, documentation, or UI.
- Follow the user's React style guide: functional arrow components, types rather than interfaces, named exports, `let` for local declarations, CSS modules, context for shared state.
- Keep browser pages sandboxed and without privileged preload code.
- Profile IDs, session IDs, window IDs, pane IDs, and tab IDs are separate identities. A profile is fixed per pane.
- Browser operations must not activate the app or change a client's selection unless the command explicitly requests that behavior.
- Use `pnpm check`, `pnpm test:electron`, and `pnpm package`. Limit worker concurrency to four.
- Tests must use disposable `BROWMUX_DATA_DIR` directories and local fixture pages. Never read a real browser profile or print secrets.
- Frontend development uses hot reload. Avoid restarting the browser just for renderer edits.
