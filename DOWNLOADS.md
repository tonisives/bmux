# Downloads

Run `downloads` in the command prompt to manage transfers for the selected pane's profile. Active transfers also appear as a `downloads:N` status-bar button.

The panel shows progress and transfer state. You can pause, resume where available, cancel, or reveal completed files. Resume behavior [depends on the server](https://www.electronjs.org/docs/latest/api/download-item#downloaditemresume).

Files save to the system Downloads directory with unique names. Transfer history lasts for the running browser process. Completed files remain on disk after quitting. Downloads also appear in `activity`.

```sh
bmux downloads --profile PROFILE_ID
bmux download pause DOWNLOAD_ID --profile PROFILE_ID
bmux download resume DOWNLOAD_ID --profile PROFILE_ID
bmux download cancel DOWNLOAD_ID --profile PROFILE_ID
bmux download reveal DOWNLOAD_ID --profile PROFILE_ID
```

Assign the `downloads` action in [keyboard configuration](KEYBOARD.md#configuration) to add a direct shortcut.
