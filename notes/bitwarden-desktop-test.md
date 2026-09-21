# Disposable Bitwarden desktop check

This optional live check runs through the serialized Tart GUI runner. It uses
the official Bitwarden desktop app in the guest, a local Vaultwarden server,
generated accounts, isolated desktop/bmux profiles, and a local login page.
It does not use the Bitwarden CLI or an existing vault.

The fixture expects the standard `bmux-tests` VM network: its host gateway is
`192.168.64.1`. Install Bitwarden **2026.8.0** at `/Applications/Bitwarden.app`
inside that VM from the [official release](https://github.com/bitwarden/clients/releases/tag/desktop-v2026.8.0).
The universal DMG SHA-256 is
`8180ae4bbb2c4686e19ebab897eb661bc4fffbfa3992779d4fb3d2251609f7d1`.
Keep the signed desktop app and its native proxy unchanged.

On the host, start a disposable server with no persistent volumes:

```sh
docker run -d --name bmux-bitwarden-fixture \
  --label bmux.fixture=bitwarden-desktop --memory 256m --cpus 1 \
  --read-only --tmpfs /data:rw,nosuid,nodev,mode=0700 \
  --tmpfs /tmp:rw,nosuid,nodev -p 127.0.0.1:18210:80 \
  -e DOMAIN=https://localhost:18210 -e SIGNUPS_ALLOWED=true \
  -e SIGNUPS_VERIFY=false -e LOG_LEVEL=warn \
  -e LOGIN_RATELIMIT_MAX_BURST=1000 -e UNAUTHENTICATED_RATELIMIT_MAX_BURST=1000 \
  vaultwarden/server@sha256:094b5689ed81549bd293418395c7cf495ae9d960fc2d4928cef2083ef913d912
```

This pins Vaultwarden **1.37.2** with web vault **2026.7.0**. The larger burst
limits permit repeated disposable account creation and sign-in. Start the bridge
in a separate terminal; it listens only on the Tart host gateway:

```sh
node scripts/fixtures/bitwarden-proxy.mjs 192.168.64.1 18211 http://127.0.0.1:18210
```

Run the GUI check from the implementation worktree:

```sh
node scripts/tart.mjs bitwarden-desktop
```

The guest exposes the vault at `https://localhost:18210`. A fresh certificate
is accepted only by the two disposable app processes through its SPKI hash;
the fixture does not edit certificate trust settings. Passwords stay in memory
and the temporary encrypted profiles. Password-breach lookup is disabled during
registration. The check refuses an existing DuckDuckGo pairing manifest and
removes the manifest it creates, along with its profiles and certificate.

Bitwarden intentionally replaces its renderer on lock to clear key material.
The check reconnects its renderer automation after that replacement. It uses
the normal desktop confirmation for every pairing request.

The runner copies evidence to `artifacts/tart/<run-time>/`. Stop the host bridge
with Ctrl+C and destroy the RAM-only vault when finished:

```sh
docker rm -f bmux-bitwarden-fixture
```

Leave Tart running for other agents. Never run this check directly on the working
desktop or use a personal Bitwarden/DuckDuckGo profile for it.
