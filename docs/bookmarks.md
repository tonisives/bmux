# Bookmarks

## Save and search

Give recurring pages a recognizable title. In the folder chooser, press `/`
from a folder row to search folders, then use Up/Down and Enter to select one.
You can create a folder inside the selected folder.

Opening a bookmark preserves the current layout and keeps its original page
available. Searches are remembered per profile during
the running UI session. This is not cross-device synchronization.

Press Command+D or run `bookmark` to save the current page. Run `bookmarks` to search saved pages and folders in the selected profile. Search results rank title matches first, followed by folder names and URLs, so URL searches such as `x.com` still find matching bookmarks. Press Enter to open a selected bookmark. Each profile has its own bookmarks.

For a saved URL with query parameters, the small sliders icon beside its title opens optional controls. Text parameters can be edited directly; numeric parameters also have sliders. Changes are saved for the bookmark and used when it opens. The × button removes a parameter from future opens and hides its control. The original saved URL stays in `bookmarks.yaml`.
For X searches, numeric `min_faves` and `min_replies` operators inside the `q` parameter also appear as separate controls. A post-age slider writes a relative `since:YYYY-MM-DD` operator when the bookmark opens; 0 keeps posts of any age. The `f` URL parameter is labeled Results, with `live` identified as Latest. X does not support a minimum post-view or impression-count search operator.

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

The destination website must support the edited parameters. These controls do
not change POST bodies or arbitrary page state. Manual bookmark YAML edits do
not reload live; edit while bmux is closed and restart, unlike keyboard settings.

## History and related guides

Run `history` to search visited pages by title or URL within the selected profile.
Select a result with Up/Down and Enter. History replaces the active page; bookmarks
keep the previous page available. Each profile keeps its 1,000 most recent distinct
history entries. Google Maps records selected places, groups map movement under the
same place, and omits map viewport and search pages. Existing Maps entries are
compacted when the profile loads. Other sites keep their full URLs, including query
parameters, because those parameters may identify different pages.
Deleting individual history entries and clearing history from
the panel remain follow-up work.

See [Import from Chrome](chrome.md) for existing folders and the
[bookmark walkthrough](https://bmux.cc/articles/bookmarks/) for parameter examples
and a Tart demonstration.
