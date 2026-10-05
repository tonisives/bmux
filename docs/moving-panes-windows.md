# Moving panes and windows

The command prompt and CLI support these tmux-style movement commands. Moves
preserve pane IDs, profiles, and live pages. Use `-c CLIENT_ID` in the CLI to
choose a client; otherwise it uses the focused client, or the first attached
client when none is focused. Movement commands do not activate the application.

| Command | Behavior |
| --- | --- |
| `joinp -s :2.0 -t :1.1 -h` | Join a source pane beside a destination pane |
| `movep -s :2.0 -t :1.1 -v -b -d` | Join above the destination and retain client selection |
| `breakp -s :1.0 -t work:2 -n notes -d` | Create a window at index 2 in another session |
| `breakp -s PANE_ID -W` | Float a pane in its existing window |
| `joinp -s PANE_ID -t PANE_ID` | Return a floating pane to its saved split position |
| `swapp -s :1.0 -t :2.1` | Exchange pane positions, including between sessions |
| `swapp -U` / `swapp -D` | Swap the selected tiled pane with its previous/next tiled neighbor |
| `rotatew -U` / `rotatew -D` | Rotate tiled pane positions; floating panes stay in place |
| `movew -s :2 -t work:1` | Transfer an entire window into another session |
| `movew -s :3 -t :1 -b` | Insert a window before another window |
| `swapw -s :1 -t :3` | Exchange two window slots |
| `swapw -s :1 -t work:2` | Exchange windows between sessions |

The full names (`join-pane`, `move-pane`, `break-pane`, `swap-pane`,
`rotate-window`, `move-window`, and `swap-window`) work in the prompt too.
The existing CLI forms `move-pane -t PANE_ID --window WINDOW_ID` and
`join-pane -t PANE_ID --destination PANE_ID` retain their source-target meaning.
Use the aliases or an explicit `-s` for tmux-style CLI source/destination syntax.

## Targets and selection

`-s` identifies the source and `-t` the destination. An omitted source uses the
current pane or window. `:1` means window 1 in the command client's current
session. `work:1.0` means pane 0 in window 1 of `work`; `.0` means pane 0 in the
current window. Window indices start at 1; pane positions after the dot start
at 0 and follow the tiled layout, then floating panes. `%1` is a stable pane
ID, independent of its position.

IDs, names, and unique name prefixes work for sessions and windows. Prefix
with `=` for an exact name. Numeric window indices take precedence over numeric
names. Relative window targets such as `:+1`, `:-1`, `:{start}`, `:{end}`, and
`:{current}` work. Pane targets also accept `.{next}`, `.{previous}`, and
`.{active}`. Missing or ambiguous targets fail before moving anything.

An omitted pane position uses the selected pane in that window. A session-only
join target uses that session's selected window. bmux uses the command client's
selection when available, then another client's selection, then the first
window or pane. bmux keeps selections per client rather than sharing one active
selection between every client attached to a session.

`-d` keeps the command client in its existing session/window where possible.
If a selected pane or window leaves, selection moves to a remaining item.
For swaps, `-d` keeps the selected slot and displays its replacement.
`-b` joins before a pane or inserts before a window; `-a` inserts after a
window. Pane swaps and rotation clear zoom unless `-Z` is given.

The prompt completes `-s` and `-t` for movement commands, including pane
coordinates. `selectw -t work:1` and `selectp -t work:1.0` use the same target
rules and switch the command client to the selected item.

## Differences from tmux

bmux keeps windows in a dense one-based order. `movew -t :2` inserts at the
final position and shifts other windows, rather than requiring an unused tmux
window index. A session-only `movew -t work:` appends the window. `movew -r`
is accepted; the ordering is already sequential.

For compatibility with existing bmux commands, `movep -t work:` creates a new
window in that session. tmux's `movep` joins an existing pane; use `breakp` when
you want an explicit new-window command in either application.

Window linking, sparse indices, marked panes, mouse targets, glob targets, and
terminal-cell sizing flags are not implemented. Unsupported movement options
report an error. Private sessions cannot exchange panes or windows with other
sessions. Floating coordinates and dimensions use bmux's pixel-based controls
described in [floating panes](floating-panes.md).
