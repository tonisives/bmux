# Keyboard

The default prefix is Control+B. Press the next key within 1.6 seconds.

| Key | Action |
| --- | --- |
| 1–9 | Select internal window 1–9 |
| ' | Prompt for an internal window index to select |
| c | New internal window |
| n / p | Next / previous internal window |
| % | Split pane side by side |
| " | Split pane above and below |
| ! | Break the selected pane into a new internal window |
| . | Move the current internal window to an index |
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

Press prefix then `'`, type the number shown on a window's status tab, and press
Enter. Indices above 9 work, and moving a window keeps its number. Escape cancels;
an unknown index keeps the prompt open. The configurable action is `select-window`.

## Native tmux shortcut audit

Compared with [tmux's default prefix bindings](https://github.com/tmux/tmux/blob/master/key-bindings.c),
these browser-relevant bindings are still missing:

| Prefix key | tmux action | Current bmux support |
| --- | --- | --- |
| Arrow keys | Select the pane in that direction | `pane-left`, `pane-down`, `pane-up`, and `pane-right` actions exist; no default prefix bindings |
| w | Choose a window | The `s` session picker also lists windows; no `w` binding |
| l / ; | Select the last window / pane | `select-window -t :!` selects the last window; no default bindings or last-pane action |
| { / } | Swap the pane backward / forward | `swap-pane -U` / `swap-pane -D` commands exist; no default bindings |
| Ctrl+O / Alt+O | Rotate panes forward / backward | `rotate-window` / `rotate-window -D` commands exist; no default bindings |
| Ctrl+arrows / Alt+arrows | Resize a pane | `resize-pane` command exists; no default bindings |
| Space / Alt+1–7 | Cycle / select pane layouts | No equivalent layout presets |
| q | Display pane numbers and select one | No numbered pane picker |
| f | Find a window or pane | The session picker can search windows; no `f` binding |

Existing differences: `r` renames a window (tmux refreshes its client), `E`
renumbers windows (tmux spreads panes evenly), and `(`/`)` cycle sessions
(tmux cycles attached clients). Window numbering starts at 1, so `0` is unbound.
Terminal copy mode, paste buffers, suspend, and clock bindings have no direct
browser equivalent.

Common direct shortcuts:

| Shortcut | Action |
| --- | --- |
| Command+1–9 | Select internal window 1–9 |
| Command+N | Open another native browser window |
| Command+Shift+N | Create a private session and switch to it |
| Command+L | Open the selected pane's address bar |
| Command+T / Command+W | New / close internal window; closing a session's last window removes the session |
| Command+Shift+T (macOS) / Control+Shift+T (Linux and Windows) | Reopen the most recently closed internal window |
| Command+Shift+[ / Command+Shift+] | Previous / next internal window |
| Command+Right Shift / Command+Left Shift | Move the current internal window right / left, wrapping at the ends |
| Command+R | Reload |
| Command+F (macOS) / Control+F (Linux and Windows) | Find in page |
| Hyper+W (Command+Control+Option+Shift+W) | Show sessions |
| Command+Shift+W | Detach the client |
| Command+D | Bookmark the current page and choose its folder |
| Command+, | Open settings |
| Command+. (macOS) / Control+. (Linux and Windows) | Pin or unpin the current window |
| F1 | Show help and shortcuts |
| Escape | Dismiss a prompt or stop loading |

Right-click a status bar tab and choose **Pin Window** to keep it on the left as an icon. Choose **Unpin Window** to restore its label after the pinned windows. Pins persist with the session, and window movement stays within the pinned or regular group. The shortcut action is `toggle-window-pin`.

On macOS, swipe horizontally with two fingers over a page to go back or forward.
Navigation happens when scrolling settles. Short or reversed swipes cancel;
horizontal page scrolling and widgets that handle the gesture keep their input.

## Click mode

For a reference lookup, activate Click Mode, press `f`, then type its link hint.
Use `h` or `l` for a left or right split. See [Floating panes](floating-panes.md)
for docking, or the [Click Mode walkthrough](https://bmux.cc/articles/click-mode/)
for captures. Hint labels depend on the current page and may change.

Double-tap Option to show keyboard hints over clickable elements in the selected pane. Type a hint to click its element. Click mode works directly in bmux, including page frames, without a browser extension or Accessibility permission.

| Key | Action |
| --- | --- |
| r | Use right-click for the selected hint |
| c | Use Command-click for the selected hint |
| d | Use double-click for the selected hint |
| n | Return to a normal click |
| f | Show link hints and open the selected link in a floating pane |
| h | Show link hints and open the selected link in a split on the left |
| l | Show link hints and open the selected link in a split on the right |
| Backspace | Remove the last hint character |
| Escape | Close click mode |

Choose a pane action before typing its link hint. The pane actions show hints for links only. Click mode only targets web content. It does not place hints over bmux's status bar or dialogs. Use the `click-mode` action to assign another shortcut or prefix binding.

Pickers support typing to search, Up/Down to select, Enter to confirm, and Escape to clear or close. Open `?` or press F1 to see active shortcuts and commands.

In session and bookmark lists, press `x` then `y` to delete the selected window, session, bookmark, or folder. The next row stays selected; at the end, selection moves to the previous row. Press `n` or Escape to cancel.

In the bookmark editor, press `/` from a folder row to search folders, use Up/Down and Enter to select one, or create a new folder inside the selected folder.

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
history
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
showBuildId: false
showTabCloseButtons: false
clickMode:
  enabled: true
  doubleTapModifier: Option
  hintCharacters: asfghjklqwetyuiopzxvbm
  showInput: true
  fontSize: 12
  opacity: 0.95
  backgroundColor: "#ffcc00"
  textColor: "#000000"
keyboard:
  prefix: Ctrl+B
  prefixTimeoutMs: 1600
  shortcuts:
    Cmd+1: select-window-1
    Cmd+R: reload
    Cmd+Shift+R: hard-reload
    Cmd+L: address
    Cmd+N: new-client
    Cmd+Shift+N: new-private-session
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

Set `showBuildId: true` to show a compact version and UTC build date (`v0.1.10 · 261023.0652`) at the right of the status bar. Click it to open General settings with the version, commit, and full ISO 8601 build timestamp. It reloads live and defaults to off.

Set `showTabCloseButtons: true` when you want close buttons on the internal-window labels.

`clickMode.doubleTapModifier` accepts `Option`, `Command`, `Control`, `Shift`, `Escape`, or `null`. Hint characters must be unique letters or digits and cannot include `r`, `c`, `d`, or `n`, which select click actions. The action-first link keys `f`, `h`, and `l` are ignored if present in an older `hintCharacters` setting. Click mode settings reload with the rest of the file.

Configured shortcuts take precedence over website shortcuts and native menu defaults. Multiple shortcuts can use the same action.

To make Command+W close the selected floating pane, while continuing to close the internal window for a tiled pane, use:

```yaml
keyboard:
  shortcuts:
    Cmd+W: close-pane-or-window
```

Pane movement actions are `pane-left`, `pane-down`, `pane-up`, and `pane-right`. Split actions are `split-right` and `split-down`. Assign any of them under `keyboard.shortcuts` or `keyboard.prefixBindings`.

Page scrolling actions are `scroll-up`, `scroll-down`, `scroll-half-up`, `scroll-half-down`, `scroll-top`, and `scroll-bottom`. A two letter binding such as `gg` goes under `keyboard.sequences`. Sequence keys use `prefixTimeoutMs` for the interval between letters. For Vim style page controls that leave text fields alone:

```yaml
keyboard:
  shortcuts:
    j: { action: scroll-down, when: pane-not-editing }
    k: { action: scroll-up, when: pane-not-editing }
    d: { action: scroll-half-down, when: pane-not-editing }
    u: { action: scroll-half-up, when: pane-not-editing }
    Shift+G: { action: scroll-bottom, when: pane-not-editing }
    r: { action: reload, when: pane-not-editing }
    Shift+R: { action: hard-reload, when: pane-not-editing }
    /: { action: find, when: pane-not-editing }
  sequences:
    gg: { action: scroll-top, when: pane-not-editing }
```

Window reordering actions are `move-window`, `move-window-left`, `move-window-right`, `move-window-first`, and `move-window-last`. Prefix then `.` prompts for the one-based destination index. Modifier-only shortcuts can distinguish the physical Shift keys with `ShiftLeft` and `ShiftRight`; the defaults use `Cmd+ShiftRight` to move the current window one position right and `Cmd+ShiftLeft` to move it one position left. Directional movement wraps to the opposite end at the boundary. The shortcuts run when the Shift key is released and are canceled if another key is pressed while it is held.

In the command finder, `movew` is an alias for `move-window`. Enter `movew` to
open the index prompt, or `movew -t 2` to move the current window to position 2
within its session. From the shell, use `bmux movew -c CLIENT -t 2`.

`BMUX_CONFIG` selects another configuration file. Normal instances respect `XDG_CONFIG_HOME`. Isolated `BMUX_DATA_DIR` instances use their own `config.yaml`.

### Conditional shortcuts

The single-letter Vim-style example above is optional, not enabled by default.

In Vim-enabled URL, rename, bookmark search, and website editors, use `f` followed
by a character to find it forward, or `F` to find it backward. `2f/` finds the
second slash; `;` repeats the find and `,` reverses its direction. `t`/`T` stop
one character before the match. These motions also extend Visual selections and
work with operators such as `df/` or `cF/`. Escape cancels an unfinished find. In URL and rename fields, Escape in Normal
mode closes the editor; from Insert or Visual mode, press Escape twice.

With **Vim editing** enabled in General settings (`vimEditing: true`), focus a
website text field and press **Ctrl+E** (the default `vim-editor` shortcut), or
click its subtle **v** hint with the mouse or click mode. Change the shortcut
under `keyboard.shortcuts`, for example `Cmd+E: vim-editor` and `Ctrl+E: null`. This works
with text inputs, textareas, and contenteditable composers, including frames and
open shadow roots. Password, disabled, and read-only fields keep their native editing.

The editor replaces the field in the page layout; it does not open a popup.
It uses the field's width and colors, and taller editors move the surrounding
content down. The editor starts in Normal mode. Use `i` to type, Vim motions and operators to
edit, and Escape to return from Insert or Visual mode. Escape in Normal mode or
`:wq`, `zz`, or `ZZ` saves and restores focus to the original field. Edits update
the original field live, so website character counts and controlled inputs react
while you type. Cursor and visual selections also follow Vim in regular inputs
and textareas. `:w` marks the current text as saved without closing; `:q` restores
the last saved text, or the opening text if you have not used `:w`. The editor
uses relative line numbers and highlights Visual selections. Editing does not
submit the website's form, but its normal input handlers and autosave can run.

The original field stays mounted and hidden while editing, then returns when
you exit. If the page independently changes its text,
removes the field, or rejects an update, the editor keeps your draft and reports the problem. Rich-text
editing writes plain text through the browser's editing commands; embedded media
and formatting are not part of the Vim draft. Custom editors that reject native
text insertion can still be edited normally.
Merge it into your existing `keyboard` mapping without replacing unrelated
preferences. Website shortcuts outside editable fields can still conflict:
configured bmux bindings take precedence. See the
[Vim navigation walkthrough](https://bmux.cc/articles/vim-navigation/) for a
scrolling and text-input demonstration.

A shortcut can specify an action and a context. For example, use Command+Z to
zoom the active pane while retaining Undo in text fields:

```yaml
keyboard:
  shortcuts:
    Cmd+Z:
      action: toggle-pane-zoom
      when: pane-not-editing
```

`pane-not-editing` requires page focus in the active pane, outside text fields.
By default, Tab and Shift+Tab use this context to switch windows only when a
page field is not focused. In a field, they move focus through the page.
The URL bar, browser prompts, website inputs, and editable page content retain
their normal keyboard behavior. If focus cannot be determined, the shortcut is
not intercepted. This includes unknown focusable controls and closed shadow
roots. Selecting ordinary page text does not count as focusing a text field.

`when: always` (or omitting `when`) preserves global shortcut behavior. Existing
string values remain valid, and `null` disables a binding. Prefix bindings keep
their existing behavior. Contexts appear alongside bindings in shortcut help.

Window numbers stay with their windows when reordered, pinned, or closed. Numeric selection shortcuts and command targets use these numbers. Prefix then `E` renumbers the current session in its displayed order, starting at 1. The command finder accepts `renumber-windows`; the tmux-style command is `move-window -r` (or `movew -r -t SESSION:`). Moving to an index still uses the destination position in the list.
