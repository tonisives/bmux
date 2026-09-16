# Import from Brave

Import Brave profile names and bookmark folders into bmux:

```sh
bmux import-brave
```

The import creates separate bmux profiles and sessions. It preserves bookmark folders and leaves Brave unchanged. Run `bookmarks` in the bmux command prompt to browse imported bookmarks. Run `bookmark` or press Command+D to save the current page to the profile root or any imported folder. The editor supports keyboard folder search and creating nested folders. Saving the same URL again updates its title and folder instead of creating a duplicate.

Run the import again to update bookmarks without duplicating profiles or sessions. Name collisions create a separate name such as `bot (Brave)`. bmux backs up an existing state file before import.

Use `--source` to select another Brave user-data directory. Website logins, passwords, site data, extensions, and Brave settings aren't copied. Unsupported URLs such as bookmarklets remain visible but disabled.
