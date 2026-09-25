# Portable hosting and remote access

bmux uses the same Electron engine for desktop and unattended hosting. Linux
hosts run under a private Xvfb display. This release does not provide a separate
Chromium headless-shell engine or claim a smaller browser bundle.

## Run a host

Build the OCI image with `docker build --target host -t bmux-host .` and run:

```sh
docker run --rm --shm-size=256m \
  --security-opt seccomp=containers/chromium-seccomp.json \
  -v bmux-data:/data bmux-host
```

The image runs as UID 1000 with Chromium sandboxing enabled. The seccomp profile
permits Chromium's user namespaces; install the corresponding profile on Kubernetes
nodes and use a Localhost seccomp profile there. Do not add `--no-sandbox`.
The image supports Debian Bookworm-compatible hosts on Linux x64 and arm64.

To embed bmux, use this image as the base for an application worker. Alternatively,
run it beside an application container with the same UID, `BMUX_DATA_DIR`, and a
shared `/tmp/bmux-1000` socket directory. Run only one host per data directory.
The application container needs Node 22.12+ and the CLI files from `resources/bin`.
Its readiness check must test the socket without auto-starting another host.

Linux release archives contain Electron and the bmux runtime. Install the system
libraries listed in the Dockerfile, extract the archive, and invoke
`node /opt/bmux/resources/bin/bmux.mjs host` under Xvfb. The CLI detects the adjacent
packaged executable; `BMUX_APP` overrides it. Mac paths remain unchanged. Linux
uses `XDG_DATA_HOME/bmux` or `~/.local/share/bmux`; `BMUX_DATA_DIR` overrides both.
SIGTERM and SIGINT close the runtime. Persistent storage restores saved browser
state, not arbitrary JavaScript memory.

## Required home egress

Set `BMUX_REQUIRED_PROXY=socks5://homeproxy:18081` on the host. It applies to every
profile, including newly created ones, and cannot be cleared through the UI or
CLI. Use a private HomeProxy gateway protected by NetworkPolicy. This option
accepts unauthenticated endpoints; it never embeds credentials in a URL.
Authenticated per-profile proxies remain available through the existing desktop UI.

The browser does not fall back to direct egress. A failed upstream connection or
proxy error response produces `PROXY_UNAVAILABLE` for synchronous navigation.
Application API/Kafka traffic and the trusted observation connection have separate
network paths. This setting does not proxy arbitrary programs launched by workers.

## Connection service

Build `docker build --target service -t bmux-remote .`. Configure:

- `DATABASE_URL`: PostgreSQL connection URI for a dedicated database.
- `BMUX_PUBLIC_ORIGIN`: public HTTPS origin of this service and viewer.
- `BMUX_GOOGLE_CLIENT_ID`: Google web client with that JavaScript origin authorized.
- `BMUX_TURN_SECRET`: shared secret for coturn's REST credential authentication.
- `BMUX_TURN_URLS`: comma-separated TURN UDP, TCP, and TLS URLs.

The process creates its initial schema and exposes `/health`. Terminate HTTPS at
an ingress that forwards WebSocket upgrades. coturn needs its own reachable relay
address and UDP port range; an HTTP ingress cannot carry TURN. Keep the TURN
shared secret only in service/TURN secret stores. Runtime code never prints it.

Hosts connect outbound using revocable service credentials. Google login grants
access to account discovery and metrics; a host separately approves browser access.
The signaling server stores service/device registrations and operational metadata.
Video, input, page URLs, titles and session state travel inside WebRTC. Signed
negotiation binds SDP fingerprints, recipient, runtime generation, nonce and expiry
to an approved Ed25519 key. A viewer pins the service's host key before watching.
The web origin serving the viewer remains trusted.

## Enroll and pair

On an administrative machine with `DATABASE_URL` configured:

```sh
pnpm remote:admin enroll --owner GOOGLE_ACCOUNT_SUB --service sitelytics-pilot \
  --url https://remote.example.com --output /private/path/host.json
```

This writes a mode-600 credential file and a separate mode-600 identity file.
Mount both into the worker and adjust `identityFile` in the credential file to its
container path. Set `BMUX_REMOTE_CONFIG` to the credential file. Each service
credential is scoped to an account and service. Replica hosts share that service
identity and get separate host IDs and runtime generations. Protect the service
key as an authority for all of its replicas.

Sign in to the web viewer, connect, and download its public key. Compare the device
fingerprint displayed in the viewer, then approve it locally:

```sh
pnpm remote:admin approve --config /private/path/host.json \
  --key /path/viewer-public-key.json --fingerprint VERIFIED_DEVICE_FINGERPRINT
```

Distribute the updated approved-client configuration to the service's hosts.
Hosts reread approvals without restarting. Enter the host fingerprint printed by
enrollment into the viewer once per service, then select Watch. Use
`bmux remote status` on a host to retrieve its fingerprint and presence.

To revoke locally, use `remote:admin revoke --config ... --fingerprint ...`.
Account owners can revoke a device through `POST /api/revoke` with their login
session; this closes its active connections. Setting a service's `revoked` field
in PostgreSQL terminates its discovery connection within 15 seconds. There is no
insecure automatic trust fallback if a key changes.

## Control and reporting

Watching does not change page selection or viewport. Take control obtains a
30-second renewable session lease. Explicit takeover invalidates the old lease.
Competing agent mutations return `CONTROL_HELD`; DOM and screenshot observation
remain available. The desktop status bar offers Reclaim control. Existing page
scripts and already-running work can continue. Queued browser mutations recheck
control when they execute. Input carries both lease and viewport generations.

Workers report attempt lifecycles through the local socket:

```sh
bmux rpc remote.job '{"id":"job-id","attempt":"unique-attempt-id"}'
bmux rpc remote.job '{"id":"job-id","attempt":"unique-attempt-id","result":"succeeded"}'
```

Use `failed` for failed attempts. Repeated terminal reports are idempotent within
the host. Counts and active browser time are reported as cumulative daily snapshots;
the service deduplicates by host, generation, day and sequence and retains 30 days.
Reporting is best effort: an unavailable service never pauses browser work, and a
crash before the next report can lose recent counters. Application queues remain
responsible for job scheduling, retries and durable outcomes.

## Verification

`pnpm check` covers shared types, signatures, replay rejection and lease behavior.
Mac GUI tests use Tart with disposable profiles. Build the `test` Docker target
and run `scripts/test-linux.sh` for Linux capture, the full viewer/control flow,
proxy outages, service authentication, reporting and revocation. The TURN-only
capture fixture accepts `BMUX_TEST_ICE_SERVERS` and `BMUX_TEST_RELAY_ONLY=1`.

The Chromium seccomp profile comes from Playwright v1.63.0:
https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json
It extends Docker's default profile for user namespace creation. Its Apache-2.0
license is included in `containers/LICENSE-APACHE-2.0`.
