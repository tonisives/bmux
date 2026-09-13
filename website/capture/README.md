# Product captures

The website uses real bmux captures from a disposable macOS Tart guest. The two
local demo pages are included here so captures are reproducible and contain no
personal browser data. The browser UI is the app itself.

Run from the implementation worktree:

```sh
pnpm test:electron --config website/capture/playwright.config.ts
```

The runner saves `artifacts/product` under the timestamped `artifacts/tart` run.
It types a local URL and presses Enter, checks attached native page views, opens
the session picker, and invokes the real CLI to update a bot-profile page. It
verifies that the human pane remains selected. Screenshots include Chromium's
rendered page previews and bmux's own controls. The guest display is woken before
capture. The host desktop is never captured.

Copy the three PNGs to `website/public/cdn/product` and the capture metadata to
this directory. Inspect the images before replacing the public files. Captures
are uploaded to the versioned Cloudflare R2 prefix recorded in `../cdn.json`.
Update the website URLs after uploading and verifying the new captures; see the
[CDN asset instructions](../README.md#cdn-assets).
