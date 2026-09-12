# bmux website

The front page uses the Sunday design, also available at `/styles/sunday/`,
with a system font and three scrolling feature sections: Split panes, Switch
sessions and Run an agent. Each has a short description and a full-width real
app screenshot. Packaging outputs to `build/bmux.app` by default. The gallery at `/styles/` also retains the earlier
Desktop and Peach directions. Preview pages are prerendered and marked `noindex`.

The [product capture workflow](capture/README.md) runs inside the isolated Tart
guest using only local sample pages. Media lives under `public/cdn/product/`.

Public product showcase at [bmux.tonis.dev](https://bmux.tonis.dev).

The website uses React, TypeScript, CSS modules, and Vite. Its production HTML is pre-rendered, so the product information and links work before JavaScript loads. All feature sections and screenshots are visible without JavaScript. JavaScript adds the copy button. Screenshots show the real app with disposable local fixture pages.

From the repository root:

```sh
pnpm install
pnpm site:dev
pnpm site:build
pnpm site:preview
```

The development server uses `http://127.0.0.1:4317`. Production static files are in `website/dist/client`. The container serves them with unprivileged nginx on port 8080. Images, including the Little lantern icon, are published under `/cdn`.

## Deployment

GitHub Actions builds the website when its source or dependencies change on `main`. It runs `pnpm check`, pre-renders the page, and pushes a Linux amd64 image to `registry.tonisives.com/bmux-website`. The workflow then commits the image digest to [`deploy/k3s/kustomization.yaml`](../deploy/k3s/kustomization.yaml). A manual run of **Deploy website** builds the current main branch again.

Argo CD's `bmux-prod` application watches `deploy/k3s` in this public repository and rolls out that exact digest to the `bmux` namespace in the `tgs` k3s cluster. Its application definition lives in `tonisives/config-repo` at `argocd/apps/bmux-prod.yaml`, alongside ClawTab. Cloudflare proxies `bmux.tonis.dev` to the cluster ingress. Traefik routes requests to nginx, and cert-manager manages the origin certificate with `letsencrypt-prod`.

Repository secrets `REGISTRY_USERNAME` and `REGISTRY_PASSWORD` authorize image uploads. The namespace's `tonisives-registry-secret` authorizes image pulls. Credentials are stored in GitHub and Kubernetes, never in this repository. GitHub's built-in token updates the image pin; the workflow has no cluster credentials.

To inspect a rollout:

```sh
kubectl --context tgs -n argocd get application bmux-prod
kubectl --context tgs -n bmux rollout status deployment/bmux-website
curl -f https://bmux.tonis.dev/health
```

To roll back, restore a previously deployed `digest` in the kustomization and push it to `main`. Argo CD will reconcile the deployment to that image.

Run `pnpm check` to check types, lint, and application unit tests. Application UI verification uses local fixtures in a disposable bmux instance inside Tart:

```sh
pnpm test:ui
```

The website makes no network requests for visitor analytics and requires no application secrets. The public source remains in the main bmux repository.
