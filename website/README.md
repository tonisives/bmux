# bmux website

Public product showcase at [bmux.tonis.dev](https://bmux.tonis.dev).

The website uses React, TypeScript, CSS modules, and Vite. Its production HTML is pre-rendered, so the product information and links work before JavaScript loads. JavaScript adds the workspace illustration, session picker, and copy button. The illustration uses fictional fixture content rather than real browser profiles.

From the repository root:

```sh
pnpm install
pnpm site:dev
pnpm site:build
pnpm site:preview
```

The development server uses `http://127.0.0.1:4317`. Production static files are in `website/dist/client`; `website/dist/server/index.js` is a Cloudflare Worker entry that serves the `ASSETS` binding. The deployment host must bind the built client directory as static assets.

Run `pnpm check` to check types, lint, and application unit tests. Website UI verification uses a disposable bmux instance and isolated configuration:

```sh
BMUX_TEST_URL=http://127.0.0.1:4317/ BMUX_TEST_SELECTOR=main pnpm test:ui
```

The website makes no network requests for visitor analytics and requires no application secrets. The public source remains in the main bmux repository.
