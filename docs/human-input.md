# Human input integrations

Local tools that edit on a person's behalf, such as Ovim, can use `--human`:

```sh
bmux --human eval -t %3 'document.activeElement.focus()'
bmux --human type -t %3 --text 'Updated draft'
```

This mode skips automation delays, reading overlays, command labels, simulated
agent pointers, agent input locks, bot protection limits, and automation leases.
It supplies no agent identity, including identity inherited from a terminal.
Ordinary automation commands keep their existing settings.

Integrations can avoid CLI startup by sending newline-delimited JSON to the local
control socket. The socket location is exported by `bin/ipc.mjs` together with
`runtimeDataDirectory` from `bin/runtime-paths.mjs`.

```json
{"method":"input.capabilities","inputSource":"human"}
{"method":"type","args":{"pane":"%3","text":"Updated draft"},"inputSource":"human"}
```

The capability response is `{"ok":true,"result":{"human":true}}`. Check it
before editing; older versions do not recognize the human-input envelope.
Each request returns the usual `{"ok":true,"result":...}` or error response.

The marker belongs to the request envelope and is accepted by the local control
socket. Remote and renderer commands cannot select this mode. Target selection,
remote control ownership, and browser/OS permission checks still apply. Browser
operations keep their target in the background unless they explicitly select or
activate it. Reopen bmux after installing a build with this runtime change.
