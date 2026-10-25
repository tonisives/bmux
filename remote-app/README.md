# bmux remote

One Expo/Metro app for web, iOS and Android. The native apps are free companions
to a bmux account. Relay and rented boxes are purchased on the web.

## Development

Run commands from this directory:

```sh
pnpm install --frozen-lockfile --child-concurrency=4
pnpm check
pnpm web
pnpm ios
pnpm android
pnpm export:web
```

Web uses the page's own origin for cookies and signaling. Serve its export with
the connection service. Native builds default to `https://remote.bmux.cc` and
the separate `@tonisives/bmux-remote` EAS project. `EXPO_PUBLIC_REMOTE_ORIGIN`
and `EXPO_PUBLIC_EAS_PROJECT_ID` override those defaults. Production needs
APNs/FCM credentials and provisioning for `cc.bmux.remote`.
Supply the Android Firebase client configuration through the
`GOOGLE_SERVICES_JSON` file environment variable in EAS.

The native viewer uses react-native-webrtc and requires a development or release
build. Expo Go does not include that module. Generated native projects are
ignored; app.config.ts and the lockfile are the sources of configuration.

## Client behavior

- Machines, sessions, windows and pages use the same tree layout across platforms.
- Try demo opens two interactive sample pages without sign-in or a live view.
  It uses the same session list and controls, and labels its local task Demo.
  Its Attention inbox opens the sample request on its exact page in Watch.
- Wide screens place sessions beside the browser. Connected sessions lead the
  list; machine setup and an unopened included browser sit below them.
- Opening a page or attention request starts in Watch.
- Zoom and pan are local. Fit to phone explicitly changes the host viewport
  while its viewer owns the control lease.
- Backgrounding closes the live view and releases control. Returning reconnects
  to the same host generation and page.
- Attention links and push data carry an opaque attention ID. The app resolves
  the authenticated target and checks its host generation, session and pane.
- Open requests appear above the session list and mark their matching pages.
  The inbox shows the computer, session, page and checking/completed status.
- Native login credentials and per-account signing seeds use SecureStore.
- Notifications use Expo tokens. Connected sessions offer Enable alerts until
  registration succeeds; Settings shows the registration status. Returning from
  system settings rechecks permission without prompting.

The shared signed viewer lives in remote/web/client.ts. Platform adapters supply
WebRTC, storage, signing, WebSocket and lifecycle behavior without changing web
Origin checks.

## Integration status

The standalone web export, iOS simulator Release build and Android arm64 Release
build compile. The native PKCE client, rotating-token storage and sign-out
adapter follow the shared mobile contract. The backend implementation is still
in progress. INTEGRATION.md records the integration behavior and runtime checks.
No desktop Origin header is used.

The client includes the revisioned attention inbox and Resume flow, default
profile discovery, session/page creation, host-side proxy setup and testing,
stream quality, and included browser opening. Backend/host integration and real
device verification remain release gates. A resume acknowledgement is not
treated as script verification.

The local Android Release APK uses Expo's generated development signing key.
Store uploads require the separate production credentials and app records.

## Verification

`pnpm check` covers coordinate conversion, stale attention targets, push/link
parsing and native/browser signing interoperability. The parent viewer unit
tests cover platform injection, signed offers and watch-only opening. The Remote
app workflow exports web and compiles both native projects. Shared browser
changes additionally require Check and Portable hosts on the final commit.

Clawtab theme attribution is recorded in THIRD_PARTY_NOTICES.md.
