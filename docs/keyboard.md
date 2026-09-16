# Keyboard

The default prefix is Control+B. Press the next key within 1.6 seconds.

| Key | Action |
| --- | --- |
| 1–9 | Select internal window 1–9 |
| c | New internal window |
| n / p | Next / previous internal window |
| % | Split pane side by side |
| " | Split pane above and below |
| o | Next pane |
| z | Toggle the selected pane between split and full-window views |
| s | Show sessions |
| : | Open command prompt |
| ? | Show help and shortcuts |
| , / r | Rename internal window |
| x | Close pane |
| & | Close internal window |
| $ | Rename session |
| ( / ) | Previous / next session |
| d | Detach client |

Common direct shortcuts:

| Shortcut | Action |
| --- | --- |
| Command+1–9 | Select internal window 1–9 |
| Command+L | Open the selected pane's address bar |
| Command+T / Command+W | New / close internal window; closing a session's last window removes the session |
| Command+Shift+[ / Command+Shift+] | Previous / next internal window |
| Command+R | Reload |
| Command+F (macOS) / Control+F (Linux and Windows) | Find in page |
| Hyper+W (Command+Control+Option+Shift+W) | Show sessions |
| Command+Shift+W | Detach the client |
| Command+D | Bookmark the current page and choose its folder |
| Command+, | Open settings |
| F1 | Show help and shortcuts |
| Escape | Dismiss a prompt or stop loading |

Pickers support typing to search, Up/Down to select, Enter to confirm, and Escape to clear or close. Open `?` or press F1 to see active shortcuts and commands.

## Command prompt

Press Control+B, then `:`, or click `:` in the status bar. Type a command or part of its name. Tab completes the selected result and Enter runs it.

```text
open https://example.com
new-session -s work --profile professional
session personal
new-window -n research
close-system-window
split-window -h --profile bot
pane-left
save-layout development
restore-layout development --confirm
bookmark
bookmarks
sessions
profiles
activity
help
```

Control+R/S moves through command history. Shift+Enter runs the text exactly as entered.

## Configuration

Edit `~/.config/bmux/config.yaml`, or press Command+,. Changes reload automatically. Omitted bindings keep their defaults. Set a binding to `null` to disable it.

```yaml
statusBar: top
keyboard:
  prefix: Ctrl+B
  prefixTimeoutMs: 1600
  shortcuts:
    Cmd+1: select-window-1
    Cmd+R: reload
    Cmd+Shift+R: hard-reload
    Cmd+L: address
    Cmd+N: new-client
    Cmd+T: new-window
    Cmd+W: close-window
    Cmd+Shift+W: detach
    CmdOrCtrl+F: find
    Cmd+Ctrl+Alt+Shift+W: sessions
    Cmd+,: settings
    Escape: stop
  prefixBindings:
    "1": select-window-1
    ":": command
    "?": help
    c: new-window
    ",": rename-window
    "&": close-window
    "$": rename-session
    "(": previous-session
    ")": next-session
```

Configured shortcuts take precedence over website shortcuts and native menu defaults. Multiple shortcuts can use the same action.

Pane movement actions are `pane-left`, `pane-down`, `pane-up`, and `pane-right`. Split actions are `split-right` and `split-down`. Assign any of them under `keyboard.shortcuts` or `keyboard.prefixBindings`.

Window reordering actions are `move-window-left` and `move-window-right`. Modifier-only shortcuts can distinguish the physical Shift keys with `ShiftLeft` and `ShiftRight`; for example, `Cmd+ShiftLeft`. They run when the Shift key is released and are canceled if another key is pressed while it is held.

`BMUX_CONFIG` selects another configuration file. Normal instances respect `XDG_CONFIG_HOME`. Isolated `BMUX_DATA_DIR` instances use their own `config.yaml`.
