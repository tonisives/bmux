# Portable hosting and remote access

bmux uses the same Electron engine for desktop and unattended hosting. Linux
hosts run under a private Xvfb display. This release does not provide a separate
Chromium headless-shell engine or claim a smaller browser bundle.

## Managed relay and rented boxes

Open **Sessions > Remote sessions > Connect relay**, or **Settings > Account**.
Sign in and activate relay for **$10 USD per account per month**. Connect the
running computer from the Account view; its sessions keep running throughout.
You can also manage the same account at <https://remote.bmux.cc/?view=account>.

Relay includes two simultaneous live pane views across the account, including
direct connections and TURN connections. Two viewers watching the same pane use
both views. Saved sessions and background jobs use no live-view allowance. If a
view is occupied, disconnect it from Account settings without closing its page
or stopping its job. Shared viewers use the host owner's allowance.

Choose **Add box** for a persistent Linux machine with 4 GB or 8 GB RAM. The
catalog lists available shared x86 machines by region. Each monthly USD price
includes the provider's server and required IPv4 cost plus a 20% service fee,
rounded up to a cent. Tax is added at checkout. The accepted price stays fixed
for that subscription; a later exchange-rate or catalog change does not change
its renewal price.

Each box has its own subscription, separate from relay. Canceling relay keeps
boxes running and billed. Cancel a box at period end to keep access until then;
the box and its files are deleted afterward. **Delete now** deletes the machine
and its files immediately and cancels that box subscription. It gives no
prorated refund. Failed setup is refunded automatically. Failed renewal has a
10-day payment recovery period before the affected service ends.

Boxes include bmux, Node, Python, Git, and optional SSH public-key access. Put
files in `/home/bmux/workspace`. Install your own agent tools and credentials;
agent usage, managed backups, and resizing are not included. Keep your own copy
of important files. The pilot permits up to three boxes per account.

Outgoing traffic is checked every five minutes. A warning is sent at 75% of the
provider's monthly allowance; networking pauses at 90% and returns for the next
provider traffic month. A burst between checks can pass these thresholds.

Session capacity depends on the pages, scripts, and CPU family. Published RAM
sizes describe the machine; they are not a promised number of sessions.

## Ask a human for help

An agent can pause a persistent pane and request attention explicitly:

```sh
bmux remote attention -t PANE_ID --episode scrape-login-2026-10-24
```

Reuse the same episode ID when retrying the same request. The pause survives a
host restart and blocks further agent mutations on that pane. Observation stays
available. Existing challenge, account-warning, and rate-limit detection also
reports attention when an active agent encounters them.

An authenticated companion app can register for a notification containing only
an opaque attention ID. It retrieves the target after sign-in, opens watch mode,
and lets the human take control. Complete the login or CAPTCHA, explicitly
resume the episode, then release control. Resume rechecks the current page and
control lease; it does not automatically restart the worker's application code.
The worker should retry its paused operation after the human releases control.

Managed relay requires host protocol 2 so live-view permits are renewed and
expire centrally. Self-hosted connection services keep billing enforcement off
unless `BMUX_MANAGED_BILLING=true` is configured.

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
shared `/tmp/bmux-1000` socket directory. Run only one host per data directory. For a dedicated legacy adapter that sends
raw socket RPC without agent metadata, set `BMUX_DEFAULT_AGENT_ID` on the host
to a stable adapter name. Explicit request identities take precedence; desktop
hosts keep requiring each caller to identify itself.
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

The process creates its initial schema and exposes `/health`. It returns 503 while
waiting for a temporarily unavailable database, then becomes ready without a
container restart. Terminate HTTPS at
an ingress that forwards WebSocket upgrades. coturn needs its own reachable relay
address and UDP port range; an HTTP ingress cannot carry TURN. Keep the TURN
shared secret only in service/TURN secret stores. Runtime code never prints it.

Hosts connect outbound using revocable service API keys. Google login grants
access to owned services and services shared with the signed-in account. The relay
stores service keys as hashes, account grants, device public keys and operational
metadata. Session names and pane titles are advertised to authorized accounts
for discovery. Video, input, page URLs and full session state travel inside WebRTC.
Signed negotiation binds SDP fingerprints, recipient, runtime generation, nonce
and expiry to the host and viewer keys authenticated by the relay. The web origin
and relay are trusted to identify hosts and enforce account grants.

## Create a service and grant access

Sign in at the remote viewer and open **Services and access**. Create a service
name and save the API key shown once. Give each agent that hosts the service a
mode-600 configuration file such as:

```json
{
  "url": "https://remote.bmux.cc",
  "token": "SERVICE_API_KEY"
}
```

Set `BMUX_REMOTE_CONFIG` to this file. The host creates its own identity in its
data directory and registers the public key when it connects. The service API
key stays the same as the agent starts and closes hosts, sessions and panes.
Each host has a separate host ID and generation. Protect the API key: anyone
holding it can connect a host to the service. Revoke the service to disconnect
its hosts and invalidate the key.

The owner can watch and control every host in the service. For another user, ask
them to sign in and send their account ID shown on the viewer page. Grant that ID
**Watch** or **Control** access under **Services and access**. Watch allows video
and pane selection. Control also allows the user to acquire a session lease and
send input. Removing a grant disconnects that user's active streams. The viewer
does not require a host fingerprint or per-browser approval.

Existing `remote:admin enroll` configurations remain supported. Their service
tokens can connect without a new config file, and hosts can use their existing
identity files. Owners can revoke a browser device through `POST /api/revoke`.
Watch reports a host rejection or timeout instead of showing an idle video area.

## Attach from the desktop app

Open the **Sessions** popup, then select **Remote sessions** in its title bar. The
popup remembers the selected tab. Sign-in and remote viewing reuse the current
bmux window. Selecting a remote session replaces its tab strip and address bar
with the remote pages and URL. The status bar offers **Take control**, **Release
control**, **Close session**, and **Disconnect**. Navigation buttons, URL entry, and tab switching
operate on the remote session; switching its tabs keeps your control lease.

The remote list shows session and service names with the host's last used
time. Hosts persist agent browser use and remote input, and advertise the latest
of that activity and local window visits. Watching, listing sessions, and lease
renewal leave the timestamp unchanged. Returning to the list highlights and focuses the last opened session,
including after restarting the app. Use the local Sessions navigation: j/k,
counts, gg/G, / to search, and x to close. The close button and x ask for yes/no
confirmation. Control access can close a hosted session from the list without
opening its video, or from the viewer's status bar. Closing ends that hosted
session and its control lease; Disconnect keeps it running. Hosts must run a
version supporting remote session closing and activity metadata. An older host
returns an update-required message before a close request is sent. The list uses
host timestamps; opening a viewer never substitutes its local visit time.

Small streams are centered in the page area. Larger streams have scrollbars.
Disconnect leaves the hosted session running and returns to the remaining local
view. Set `BMUX_REMOTE_URL` before launching bmux to use a different HTTPS service
origin. The default is `https://remote.bmux.cc`.

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
