# Fingerprint profiles

Open a pane's Profile settings and choose Fingerprint. The sections are Profiles,
Device, Proxy, Viewport and HTTP cache. Both the local app and Accounts use
**Lock viewport** for the fixed page size.

Profiles saves the current pane's device, proxy endpoint and locked viewport under
a name. Apply to pane restores that configuration on another pane while retaining
its browser profile. Device and Proxy retain their separate new pane defaults.
HTTP cache is managed for the selected browser profile.

Under Share profiles, Copy profile JSON produces a versioned configuration that
another bmux host can import. Proxy credentials and browsing data stay on each
host. Save authenticated proxy credentials in Proxy on the destination before
applying the imported profile. Included proxy routes use the destination's access.

Profiles are stored locally; distribution uses copy and import. Hosts can exchange
configuration through the local socket as well:

```sh
bmux rpc fingerprint.list '{}'
bmux rpc fingerprint.export '{"fingerprint":"fingerprint_example"}'
bmux rpc fingerprint.import '{"fingerprint":{"version":1,"id":"fingerprint_example","name":"Desktop 1280","viewport":{"width":1280,"height":800}}}'
```

Applying a fingerprint uses the local UI. Account seals preserve their existing
connection, device and viewport. Accounts receives each connected host's effective
proxy endpoint and device summary alongside its existing viewport and exit checks.
