# Bookmarks

## Save and search

Give recurring pages a recognizable title. In the folder chooser, press `/`
from a folder row to search folders, then use Up/Down and Enter to select one.
You can create a folder inside the selected folder.

Opening a bookmark in a new window preserves the current layout and keeps its original page
available. Search, selection, scroll position, collapsed folders, and the All
profiles preference are remembered locally across app restarts. Search and
selection are saved per profile. This is not cross-device synchronization.

Navigate bookmark rows with `j`/`k`, counts such as `3j`, `gg`/`G`, or
Ctrl+N/Ctrl+P. Ctrl+F/Ctrl+B move ten rows. Relative numbers before bookmark titles show
the distance from the selected row, which displays 0. Hidden and unsupported
bookmarks are skipped. Press `/`, `i`, or `a` from a row to edit the search. With **Vim
editing** enabled, the search supports the same normal, insert, and visual modes
as the address field, including word motions and delete/change commands. Escape
returns to normal mode; `j`/`k` then selects results. Escape in normal mode closes
the view and preserves the search. With Vim editing disabled, search accepts
ordinary typing. The bookmarks panel reserves half its width for settings and has
a minimum height of 520 pixels when space permits. Its height changes with search
results, while hovering, navigating folders, and changing plugin settings leave
its size fixed. It fits within smaller windows; the list and settings scroll independently.

Press Command+D or run `bookmark` to save the current page. The + button in the bookmarks view opens the same menu when the current page can be bookmarked. Run `bookmarks` to search saved pages and folders in the selected profile. Enable **All profiles** to include other profiles, grouped by profile name; this choice is remembered when you reopen the view. Each bookmark opens in its owning profile, with that profile's saved URL parameters. Search results rank title matches first, followed by folder names and URLs, so URL searches such as `x.com` still find matching bookmarks. Hover a row or navigate with the keyboard to preview its settings beside the list; mouse hover takes priority. Use the row Open buttons to open in the same tab or a new tab, or press Enter to open a selected bookmark in a new tab. In normal mode, `o` opens in the current tab and `Shift+O` opens a new internal window (tab). These keys work from a bookmark row or the normal-mode search field and follow mouse hover when present. Same-tab opening requires the current pane’s profile. Folder rows participate in keyboard navigation: Left/Right collapse and expand them, and Enter or Space toggles them. Relative line numbers stay at the far left, before folder chevrons. Each profile keeps its own bookmarks; reordering stays within its profile and folder.

The + button beside each folder opens the current-page menu with that folder selected, in both search results and the full list. In **All profiles**, it saves to the folder's owning profile without changing the current page's profile.

Click a folder's left chevron or title to collapse or expand it. Use the **Reorder bookmarks** icon at the top to show or hide drag handles for bookmarks and folders. The handles also support Option+Up/Down. These controls work in both the full list and search results.

Right-click a bookmark or folder for Rename and Delete, in both the full list and search results. The list dims while the menu is open; clicking outside the menu closes it without opening a bookmark or changing a folder. Rename opens an inline title editor: Enter or leaving the title saves; Escape cancels. Clicking a bookmark title keeps the list open; use an Open button to navigate. Deleting a folder also deletes its contents. These actions change only the owning profile, including in **All profiles**.

For a saved URL with query parameters, the small sliders icon beside its title opens settings to the right of the bookmark list. The settings panel takes half the split view, with Open buttons at the bottom. The list and settings scroll independently. Text parameters can be edited directly; numeric parameters also have sliders. Changes are saved for the bookmark and used when it opens. The × button removes a parameter from future opens and hides its control. The original saved URL stays in `bookmarks.yaml`.
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
opened in a new window keep the previous page available. Each profile keeps its 1,000 most recent distinct
history entries. Visits with the same host, path, and page title share one entry even
when query parameters change. The most recent URL is kept so the result reopens that
visit. Pages with different titles remain separate. Google Maps records selected
places, groups map movement under the same place, and omits map viewport and search
pages. Existing history entries are compacted when the profile loads.
Deleting individual history entries and clearing history from
the panel remain follow-up work.

See [Import from Chrome](chrome.md) for existing folders and the
[bookmark walkthrough](https://bmux.cc/articles/bookmarks/) for parameter examples
and a Tart demonstration.

## Bookmark plugins

Enable **Reddit search filter** in the Plugins panel, then open a Reddit search
bookmark's sliders and choose it under **Add plugin**. The sliders are available
on bookmarks without query parameters too. The plugin selector is hidden when
there are no matching enabled plugins left to add. Configure minimum score and comments
(default 2 each), whether results must meet both or either minimum, and duplicate
post, link/crosspost, and title filtering. A minimum of 0 disables that threshold.
Unknown counts remain visible. The first qualifying duplicate stays visible;
matching titles ignore case and repeated whitespace but preserve punctuation.

Opening the bookmark attaches its plugins to the new pane. Choosing a bookmark
from address suggestions attaches them to the current pane instead. Other panes, copied
windows, and links opened in new panes do not inherit them. Attachments survive
reloads and browser restoration, and run only on matching pages. The Reddit
filter affects post search results, including infinite scrolling, rather than
feeds or discussion comments. Filtering uses loaded page data and does not fetch
additional results.

A compact overlay appears on matching pages with an on/off toggle and
**Configure** controls for each attached plugin. Changes update the bookmark and
its existing open panes. Turning a filter off restores the results it hid; the
overlay remains available to turn it back on. Removing an attachment removes its
overlay too. Missing or globally disabled plugins are shown as unavailable.

Attachments live in `bookmark-plugins.yaml` beside `config.yaml`, keyed by profile
and bookmark ID. Like bookmark YAML, manual edits are loaded at startup. Use the
sliders or overlay for live changes.
