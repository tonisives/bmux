# Floating panes

Floating panes sit above the split panes in one internal bmux window. Use a
float for a temporary reference; use a split when pages should remain visible
without overlap. A float is not a separate operating-system window.

## Open and arrange

- Right-click a link and choose **Open Link in Floating Pane**.
- Right-click a pane's page or address bar and choose **Float Pane**.
- In [Click Mode](keyboard.md#click-mode), double-tap Option, press `f`, then
  type the link hint. Choose `h` or `l` instead for a left or right split.
- Drag the floating header to move it. Drag an edge or corner to resize it.
- Select a float to bring it in front of other floats.

Floats belong to their internal window. Switching windows changes which floats
are visible. Positions, dimensions, and stacking order are persisted.

## Dock or move

Right-click the floating header and choose **Return to Split**. The former split
position is restored when available. **Move to Window** moves the pane to another
internal window. These operations preserve the pane, its fixed profile,
and live pages. A browser restart reloads pages and cannot restore arbitrary
JavaScript state or unsaved forms.

The command prompt (Control+B, then `:`) accepts:

```text
new-pane
break-pane -W
join-pane
```

`new-pane` creates a float; `break-pane -W` floats the selected pane;
`join-pane` docks it. Scripts use explicit source pane IDs:

```sh
bmux move-pane -t PANE_ID --x 100 --y 80
bmux resize-pane -t PANE_ID --width 640 --height 480
bmux move-pane -t PANE_ID --window WINDOW_ID
```

Coordinates are pixels inside the workspace, excluding the status bar. `-t`
remains the source pane. Replace the IDs with real IDs from your workspace.

The tmux-style aliases use `-s` for the source and `-t` for the destination. For
example, `movep -t work` moves the selected pane to the first window in the
`work` session, and `joinp -s PANE_ID -t DESTINATION_PANE_ID` joins an explicit
pane beside another pane. Like tmux, bmux resolves an unqualified destination as
a pane, then a window in the current session, then a session. Session and window
IDs, names, and one-based indices are accepted. Explicit targets may use
`SESSION:WINDOW`, `SESSION:`, `:SESSION`, or `:{SESSION}`.

## Close a float

Use its close button or the close-pane action. To make Command+W close a selected
float while retaining internal-window closing for a tiled pane, merge this into
the existing configuration:

```yaml
keyboard:
  shortcuts:
    Cmd+W: close-pane-or-window
```

This is optional. The default Command+W action closes an internal window.

## Context links

The context menu resolves X post detail links, including JavaScript-driven cards.
Other applications can expose context URLs through a
[userscript hook](browser-tools.md#javascript-driven-context-links).

See the illustrated [floating panes versus splits guide](https://bmux.cc/articles/floating-panes/).
