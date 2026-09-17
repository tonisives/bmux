# Bookmarks

Press Command+D or run `bookmark` to save the current page. Run `bookmarks` to search saved pages and folders in the selected profile. Search results rank title matches first, followed by folder names and URLs, so URL searches such as `x.com` still find matching bookmarks. Press Enter to open a selected bookmark in a new tab. Each profile has its own bookmarks.

For a saved URL with query parameters, the small sliders icon beside its title opens optional controls. Text parameters can be edited directly; numeric parameters also have sliders. Changes are saved for the bookmark and used when it opens. The × button removes a parameter from future opens and hides its control. The original saved URL stays in `bookmarks.yaml`.

Bookmarks are stored in `~/.config/bmux/bookmarks.yaml`, beside the keyboard settings in `config.yaml`. bmux creates the file automatically. Existing bookmarks in `state.json` move to YAML when you first start this version; subsequent state saves omit them.

The file groups bookmarks by profile ID. Folders have `children`; pages have a `url`:

```yaml
profiles:
  profile_default:
    - id: reading
      title: Reading
      children:
        - id: example
          title: Example
          url: https://example.com
  profile_bot: []
```

You can edit the YAML while bmux is closed. Restart bmux to load edits. Keep each bookmark's `id` unique within its profile, and use the IDs shown in the existing file for your profiles. An invalid YAML file prevents startup so bmux does not overwrite your edits.

`BMUX_CONFIG` selects the settings file whose directory contains `bookmarks.yaml`. `XDG_CONFIG_HOME` changes the default config directory. Isolated `BMUX_DATA_DIR` instances keep both YAML files in their data directory.

Parameter values and hidden parameters live separately in `bookmark-parameters.yaml` in the same directory as `config.yaml`. bmux creates it when you customize a bookmark. Entries are keyed by profile ID and bookmark ID.
