# Profiles, proxies, and device personas

A profile stores cookies, site storage, history, bookmarks, extensions,
permissions, and connection settings. Sessions organize windows; they are not
profiles. A pane keeps its profile after a page is loaded.

## Choose a profile

Open profile details from the status bar. Panes with the same profile share
settings and logins. A split inherits its source profile unless another is
specified. Create a new pane when you need a different profile:

```sh
bmux profile create review
bmux split-window -t PANE_ID -h --profile review
```

When creating a session in the session picker, choose an existing profile or
create one there. A session with one window and only blank panes can change its
profile from the profile panel. If you close a session and later give a fresh,
unvisited session the same name, bmux restores the closed session's profile.
Choosing a profile explicitly or loading a page keeps the new session's profile.

The default profile throttles inactive pages. The `bot` profile keeps background
pages running; `profile create NAME --background` creates another such profile.
Profiles are not an authorization boundary against the local CLI.

## Configure a proxy

In profile details, find **Connection**. Choose **Custom**, then HTTP, HTTPS,
or SOCKS5. Enter the host and port. Enable authentication when needed and enter
both credentials. Choose **Save proxy**.

Changes reload open panes using this profile. Finish unsaved page work first.
Other profiles retain their own settings.

Credentials are encrypted with Electron safeStorage and stored separately from
ordinary profile state. Saving credentials fails if OS encryption is unavailable.
Authenticated SOCKS5 uses a private loopback relay because Chromium does not
directly support SOCKS5 credentials.

**Use system connection** removes the profile proxy. It does not disable a system
VPN or proxy. HTTP/HTTPS describes the proxy protocol, not the destination's security.

## Verify and troubleshoot

Choose **Test connection** after saving a working endpoint. Success shows the
reported exit IP. Open the **Proxy** panel from the proxy icon to inspect the
connection and reported region when available.

Verification is a point-in-time result, not a guarantee about all traffic or
another website's location detection. A profile proxy is not a system-wide VPN
and does not make a signed-in account anonymous.

At startup, configured proxies are verified before page navigation is restored.
If setup or verification fails, affected profile pages are paused. The notification
offers **Proxy settings** and **Disable proxy and continue**. Check protocol,
host, port, credentials, and service availability. This startup protection is
not a general system-wide kill switch.

## Optional provider presets

Enable `bmux.nordvpn` in the Plugins panel for its provider and region choices.
It is disabled by default. Presets supply endpoint, protocol, and port; core bmux
manages credentials and connections.

Use the provider's required service credentials and test the connection. A preset
does not create an account or include paid service. See [Plugins](plugins.md)
for the provider manifest format.

## Mobile device personas

The Device section offers Pixel 8, Galaxy S24, iPhone 15 Pro, and iPhone 15 Pro Max
presets. Custom personas support Android or iOS presentation with dimensions and
device pixel ratio. Choose orientation, locale, timezone, and optional geolocation.

Personas are independent of routing: a mobile preset does not supply a carrier IP,
and a timezone does not select a proxy region. Geolocation uses the permission flow.

The engine remains Chromium. An iPhone persona does not turn bmux into Safari or
reproduce all hardware behavior. Check engine- and hardware-specific behavior on
the actual target device.

See the illustrated [profile proxy guide](https://bmux.cc/articles/profile-proxies/).
