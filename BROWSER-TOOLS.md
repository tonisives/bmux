# Browser tools

Enter `browser-tools` in the command prompt (status bar `:`, or prefix then `:`).
The panel is also available from Settings. It contains ad blocking, website dark
mode, filter updates, and userscripts. Controls show settings for the selected
scope; site overrides still take precedence over profile and global defaults.

## Ad and tracker blocking

Blocking is on by default in every profile. bmux bundles an offline
EasyList/EasyPrivacy snapshot and uses Ghostery's filtering engine. Lists older
than seven days refresh in the background. Failed updates retain working lists.
Compilation runs in a worker outside the UI thread.

Subresource requests are filtered before leaving the browser. CSS rules hide
matching elements, including dynamic elements on visible pages. Ordinary
main-frame navigation is allowed. Filter scriptlets, response-body rewriting, and
extended cosmetic selectors are not implemented. Cosmetic hiding processes the
main document; iframe requests still use network filtering.

The panel shows blocked counts and the last 50 blocked resource hosts/types. It
does not retain paths, query strings, headers, or bodies. Counts reset on navigation.

```text
adblock off
adblock on
adblock inherit
adblock off --scope profile
update-filters
```

Disabling blocking changes subsequent requests and removes cosmetic hiding.
Reload to retry resources that were already blocked.

## Website dark mode

Dark Reader runs in a separate page execution world without a privileged preload.
`Cmd+Shift+D` toggles recoloring for the current site in the current profile.

```text
dark on
dark off
dark system
dark inherit
dark on --scope profile
```

`system` follows the operating system's color scheme. The bmux interface keeps its
existing appearance. Use site exceptions for pages with their own preferred theme.
Recoloring begins at DOM readiness. Dark Reader reuses an available page style
nonce; strict policies without a compatible nonce can limit recoloring. bmux does
not relax a page's content security policy. Ad-hiding CSS and user styles install
through Chromium's user stylesheet API and are independent of page style policies.

## Scope and configuration

Site overrides take precedence over profile settings, then global settings. Site
keys are exact origins including scheme and port, without trailing slashes. Use
profile IDs from `bmux profile list`; renaming profiles preserves their settings.
Existing site overrides still apply when changing a profile or global default.

Controls update only relevant YAML keys, preserving comments and unrelated edits.
Invalid edits retain the last working configuration.

```yaml
keyboard: {}
browser:
  adblock: true
  darkMode: off
  autoUpdateFilters: true
  rules:
    - '||ads.example.test^'
    - '@@||allowed.ads.example.test^'
    - 'example.test##.sponsored'
  profiles:
    profile_default:
      darkMode: system
      sites:
        https://example.test:
          adblock: false
          darkMode: off
```

Custom network exceptions override bundled lists. Custom cosmetic rules add
selectors; use a site's blocking toggle to exempt it from cosmetic hiding.
CLI commands require explicit tab IDs and never activate clients:

```sh
bmux dark on -t TAB_ID
bmux adblock off -t TAB_ID --scope profile
bmux update-filters
bmux rpc browser.status '{}'
```

## Userscripts and styles

Files resolve relative to the configuration file. Entries require explicit URL
patterns and are disabled unless enabled. Optional profile IDs limit execution.

```yaml
browser:
  userscripts:
    - id: clean-docs
      name: Clean documentation
      file: ./userscripts/docs.css
      enabled: true
      matches: ['https://docs.example.test/*']
      exclude: ['https://docs.example.test/editor/*']
      profiles: [profile_default]
    - id: page-shortcuts
      file: ./userscripts/shortcuts.js
      enabled: true
      matches: ['https://example.test/*']
      runAt: document-start
```

JavaScript runs in the main page with website capabilities. It receives no Node,
privileged preload, plugin host, or Greasemonkey `GM_*` APIs. It runs only in the
main frame. `document-start` precedes page scripts; the default `document-end`
waits for DOM readiness. CSS installs when the document is ready. Website-created
popups can start loading before script registration.

Files reload live. CSS changes apply to matching open pages; JavaScript changes
apply on the next navigation/reload. Disabling JavaScript prevents future
execution but cannot undo previous effects. Invalid JavaScript edits keep the
previous valid source and show an error. Files are limited to 1 MB.
`reload-scripts` forces a rescan.

## Saved forms

The bundled **Saved forms** plugin is enabled by default. Fill a form, run
`save-fill`, and name it. `fill` opens a picker for the exact origin and current
profile. The plugin panel also has a delete action. Filling never submits.

Supported fields are visible editable text/email/tel/url/search inputs and
textareas. Password and hidden inputs are excluded. Fields labelled as passwords,
tokens, card data, or one-time codes are excluded too. Document identity and field
types are checked again before filling; changed documents, missing fields, or
changed field types are rejected.

Values and names use Electron `safeStorage` encryption (macOS Keychain) in
`saved-forms/` inside bmux's data directory. If OS encryption is unavailable,
saving fails instead of using plaintext. Profiles can hold up to 100 forms.
Values do not appear in plugin history or browser state. Filled text is accessible
to its website and trusted local automation, as manually entered text is.

## Bitwarden

The bundled **Bitwarden CLI** plugin uses the documented `bw` CLI and is disabled
by default. Install the CLI, run `bw login` once in a terminal, and enable the
plugin in bmux's `plugins` panel. Then run `passwords` or its fill action.

Unlock once in bmux and choose a matching login. The main process keeps the session
key in memory until bmux quits, your Mac locks or sleeps, or you disable the plugin.
You do not need to save the key, export it in your shell, or add it to config.
An inherited `BW_SESSION` is consumed once at startup and excluded from plugin
subprocesses. Passwords and keys never enter command arguments, config, clipboard,
plugin results, or browser state. The CLI receives secrets through its private
subprocess environment. The master password is not retained.

Run `passwords lock` to forget the session and cancel all pending fills in bmux.
This does not run `bw lock` or invalidate other CLI clients. A session invalidated
outside bmux requires unlocking again on the next `passwords` action.
Items with Bitwarden's master-password reprompt enabled require a fresh check for
each selection; unlocking during that selection satisfies the check.

Only results of the CLI's origin lookup with an exact matching HTTP(S) origin are
offered. Different schemes, ports, subdomains, deleted items, and never-match URI
entries are excluded. This does not reproduce all Bitwarden path/equivalent-domain
matching. Username-only, password-only, and combined login forms are supported.
After filling a username, click Next yourself: bmux watches for the password step
for two minutes, including same-origin page navigation. It fills once in that
same tab and browser profile, without another picker or unlock prompt. Waiting
pauses while that tab is inactive and never changes focus or blocks shortcuts.
Run `passwords cancel` to stop waiting in the current tab.

Continuation ends on completion, expiry, cross-origin navigation (including
redirects), tab closure, renderer failure, cancellation, or vault locking. A new
selection replaces the previous continuation. Ambiguous forms and already-filled
password fields are left alone. It does not submit, fill iframes or registration
password fields, save vault entries, handle passkeys, or fill TOTP. HTTP fills
require one confirmation covering both steps of that selected login.

`BMUX_BITWARDEN_CLI` selects a custom executable. Otherwise bmux checks
`/opt/homebrew/bin/bw`, then PATH. Bitwarden's `BITWARDENCLI_APPDATA_DIR` can select
an account directory. Tests use a mock CLI and disposable credentials; real-account
login is a user setup step.

The [desktop pairing experiment](examples/plugins/experimental.bitwarden/README.md)
remains separate. This CLI provider does not use or replace its pairing key.

## Plugin host additions

`browser.forms` grants `forms.list`, `forms.save` (`name`), `forms.fill` (`id`), and
`forms.delete` (`id`) for the captured tab/document/origin/profile. Responses
contain metadata or counts, never stored values. Calls bypass automation queues.

Bundled plugins use bmux's embedded Node runtime, with no separate Node install.
Local plugins remain OS processes with user privileges; see [PLUGINS.md](PLUGINS.md).
Local plugins cannot shadow bundled IDs. Neither system loads Chrome Web Store
extensions.
