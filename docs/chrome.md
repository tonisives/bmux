# Import from Chrome

Import profile names and bookmark folders from Chrome or another Chromium-based
browser by passing its user-data directory:

```sh
bmux import-brave --source "$HOME/Library/Application Support/Google/Chrome"
```

The command name is retained for compatibility, but `--source` can point to a
Chrome, Chromium, Brave, or other compatible Chromium user-data directory. The
import creates separate bmux profiles and sessions. It preserves bookmark folders
and leaves the source browser unchanged. Run `bookmarks` in the bmux command prompt
to browse imported bookmarks. Run `bookmark` or press Command+D to save the current
page to the profile root or any imported folder. The editor supports keyboard
folder search and creating nested folders. Saving the same URL again updates its
title and folder instead of creating a duplicate.

Run the import again with the same source to update bookmarks without duplicating
profiles or sessions. bmux backs up existing state and bookmark files before
import. Imported bookmarks are stored in `~/.config/bmux/bookmarks.yaml` (see
[Bookmarks](bookmarks.md)).

Website logins, passwords, site data, extensions, and browser settings aren't
copied. Unsupported URLs such as bookmarklets remain visible but disabled.
