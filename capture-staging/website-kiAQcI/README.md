# Product captures

## Feature articles

`pnpm site:article-capture` stages the five-feature walkthrough in the public
repository and runs it through Tart. It uses disposable profiles and the local
`features.html` fixture. Output consists of native guest screenshots, five
silent step videos with titles, and WebVTT captions. Each step lasts four
seconds; these videos are not continuous recordings or performance benchmarks.

The current verified guest desktop is 2048 by 1536 pixels. The assembly script
crops the app region to 2008 by 1280 at offset 20,82 and resizes to 1200 pixels
wide. Recheck the crop if the guest display or window placement changes.
`features.capture.json` records the capture provenance and individual steps.

To assemble a completed run without repeating browser actions:

```sh
node etc/scripts/article-capture.mjs /absolute/path/to/artifacts/feature-articles
```

The proxy demonstration uses a local endpoint and makes no claim of a real
regional exit or external verification. Captions are also copied to the site's
`public/captions` directory so the video player can load them from the same
origin without requiring a shared-bucket CORS policy change.

After visual inspection, `node etc/scripts/upload-article-media.mjs` uploads the
complete CDN directory to a content-derived versioned prefix and verifies bytes
and content types over HTTPS. It reads configured credentials without printing
them. Update source URLs to the verified base recorded in `website/cdn.json`.

For page QA, build the site, stage its `dist/client` directory as `article-site`
inside the public worktree, and stage `articles-qa.test.ts` with its config.
Run through `scripts/tart.mjs electron --config PATH/articles-qa.playwright.config.ts`.
The check exercises CDN media, caption loading, and 1200/390-pixel layouts.

The website uses real bmux captures from a disposable macOS Tart guest. The two
local demo pages are included here so captures are reproducible and contain no
personal browser data. The browser UI is the app itself.

Run from the private workspace root. This stages the fixtures temporarily into
the public checkout so its Tart runner includes them in the disposable guest:

```sh
pnpm site:capture
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

The split-pane capture adds a vertical split inside the right pane, showing both
directions in one image. `split-panes.capture.json` records its latest capture;
`capture.json` records the unchanged session and agent images.

## Demo video

For independently captured chapters and a short assembled overview, see
[the reusable chapter workflow](../../etc/scripts/demo-chapters/README.md).
It keeps the logo fixed at top left, animates titles to the bottom left, and
places single-pane shell control before parallel agent monitoring.


The product demo is a silent, timed capture from a disposable Tart guest. It
browses Google Cloud Console and live public DEV, Reddit, Hacker News, and GitHub pages in
separate profiles. It demonstrates keyboard-driven splits and session switching,
Click Mode, a floating reference, profile proxy settings, and CLI control from a
visible Terminal window. Prepare a dedicated bot-profile login in the recording
VM first:

```sh
BMUX_TART_HEADLESS=0 node etc/scripts/demo-video.mjs --login
```

Sign in to Google Cloud, select the demo project, open Compute Engine, and tell the recording agent you are ready (or quit
the demo bmux). The login stays in `~/bmux-demo-cloud` inside the VM, outside
capture artifacts. Login screens are never recorded. Capture copies that
purpose-created profile into a temporary guest directory and validates the
selected Compute Engine project route. The original login remains
available for later takes; other browser profiles are never imported.

Then record:

```sh
pnpm site:demo-video
```

The demo config enables j/k scrolling outside text fields. Four profile workers
start in sequence and continue sending real scroll commands in the background.
The shell occupies one third of the window and pipes DOM text through jq and grep.

Use `node etc/scripts/demo-video.mjs --public-preview` to review layout and pacing
without a Google login. This is explicitly a public-site preview, not the final
Cloud workflow. `--shell-only` records just the CLI chapter for a focused retake.
`BMUX_DEMO_OUTPUT` selects a local output directory.

The capture explicitly selects a guest display mode of at least 1400 by 900
and uses a 1344 by 680 workspace at normal page zoom. Session switches
include typed searches. Proxy actions remain visible while fields scroll. The
shell layout appears in one cut, with a smaller font and no persistent scrollbar.

The sequence teaches splits and keyboard navigation before Click Mode and
floating panes, then introduces sessions, background profiles, proxies, and
shell control. Each chapter pauses before the action and holds on its result.

The command captures the guest screen without its native cursor. The full
window sits on a padded desktop backdrop. Each chapter title appears briefly in
the center, then moves to the bottom left beside the centered shortcut cues.
The bmux mark stays beside the title. Cursor movement is limited to recorded
mouse gestures, with a small pulse on clicks; keyboard actions hide the cursor.
It writes the draft video and poster to
`artifacts/demo-video-render/`; they stay local while the cut is reviewed. Unrecorded native-window setup waits are trimmed to a quarter-second hold;
`edit.json` records those cuts. The source frames and action timeline remain in
the Tart artifacts. To revise the
composition without repeating browser actions, run
`node etc/scripts/demo-video.mjs --render-only PATH/timeline.json` from the workspace
root. The proxy test points to a local fixture and does not demonstrate a
regional exit.
