# Switching clients

In the `:` prompt, use `switchc -t %29` to switch the current client to pane
`%29`, including its session and window. `switchc` is the tmux alias for
`switch-client`. The shell CLI accepts the same flags:

```sh
bmux switchc -c CLIENT -t %29
```

Targets also accept session names or IDs, `SESSION:WINDOW`,
`SESSION:WINDOW.PANE`, `:WINDOW.PANE`, and `.PANE`. Pane indexes start at zero;
window numbers are the numbers shown in the status bar. Session names may be
abbreviated when unambiguous. The prompt completes session, window and pane
targets after `-t`.

| Flag | Behavior |
| --- | --- |
| `-c CLIENT` | Choose the client to change; otherwise use the current client. |
| `-t TARGET` | Select a session, window or pane. |
| `-l` | Return to the last session visited by that client. |
| `-n`, `-p` | Switch to the next or previous session, wrapping at either end. |
| `-O ORDER` | Order cycling by `name` (default), `size` (window count), `creation`, or `activity`. |
| `-Z` | Keep the destination window zoomed when selecting a pane. |
| `-r` | Toggle read-only mode and the client's `ignoreSize` flag. |
| `-T TABLE` | Use a key table for the next key, then return to `root`. This changes the table without switching sessions. |
| `-E` | Accepted for tmux compatibility; browser sessions have no shell environment to update. |

Short flags can be combined, for example `switchc -Zt%29` or `switchc -En`.
A pane target clears the destination zoom unless `-Z` is supplied. Session-only
switching restores that client's last window in the destination session.

Read-only clients block page keyboard/mouse input and UI commands that change
browser state. The command prompt, switching bindings and detach remain available;
use `switchc -r` again to restore input. Each bmux client has its own viewport,
so `ignoreSize` does not resize other clients. External automation keeps its
existing input path.

`root` uses normal shortcuts; `prefix` uses `keyboard.prefixBindings`. Define
additional one-key tables in the existing configuration:

```yaml
keyboard:
  shortcuts:
    Ctrl+A: switchc -T table1
  keyTables:
    table1:
      b: switchc -T table2
    table2:
      c: command
```

Here Ctrl+A, then `b`, then `c` opens the command prompt. Unknown tables report
an error. Modifier keys alone do not consume a table selection.
