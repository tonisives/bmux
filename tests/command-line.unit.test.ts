import { expect, it } from 'vitest'
import { initialModel, newPane, newSession, newWindow, splitLayout } from '../src/main/model'
import { parseCommandLine, tokenize } from '../src/shared/command-line'
import type { PublicState } from '../src/shared/types'

let state = (): PublicState => {
  let model = initialModel(), session = model.sessions[0], window = session.windows[0], pane = window.panes[0]
  model.clients.push({ id: 'client', sessionId: session.id, windowId: window.id, paneId: pane.id, width: 1280, height: 850 })
  return { model, clientId: 'client', focusedClientId: 'client', snapshots: {}, crashes: {}, loading: {}, audio: {}, favicons: {}, pendingUrls: {}, navigation: {}, permissions: [], downloads: [], profileCaches: {}, profileProxyTests: {}, profileProxyFailures: {} }
}
it('parses quoted names and URL arguments without shell interpretation', () => {
  expect(tokenize(':new-session -s "work space" --profile professional')).toEqual(['new-session', '-s', 'work space', '--profile', 'professional'])
  let current = state()
  expect(parseCommandLine('open https://example.test/?a=1&b=$HOME', current)).toEqual({ method: 'navigate', args: { pane: current.model.sessions[0].windows[0].panes[0].id, url: 'https://example.test/?a=1&b=$HOME' } })
  expect(parseCommandLine('new-session -s "work space" --profile professional', current)).toMatchObject({ method: 'new-session', args: { name: 'work space', client: 'client', profile: 'professional' } })
  expect(parseCommandLine('new-session -s secret --private', current)).toMatchObject({ method: 'new-session', args: { name: 'secret', client: 'client', private: true } })
  expect(() => tokenize('open "unfinished')).toThrow('Unfinished quote')
})

it('routes manual automation resume to the selected pane', () => {
  let current = state()
  expect(parseCommandLine('automation resume', current)).toEqual({ method: 'automation.resume', args: { pane: current.model.clients[0].paneId } })
  expect(parseCommandLine('automation safety', current)).toEqual({ method: 'automation.safety' })
})
it('resolves current targets, numeric indices, and confirmation flags', () => {
  let current = state(), session = current.model.sessions[0], window = session.windows[0]
  let secondWindow = newSession('second', session.defaultProfileId).windows[0]
  session.windows.push(secondWindow)
  expect(parseCommandLine('select-window -t 1', current)).toMatchObject({ args: { window: window.id } })
  expect(parseCommandLine('select-window -t 2', current)).toMatchObject({ args: { window: secondWindow.id } })
  expect(parseCommandLine('split-window -v --profile bot', current)).toMatchObject({ args: { pane: window.panes[0].id, axis: 'vertical', profile: 'bot' } })
  expect(parseCommandLine('pane-left', current)).toEqual({ method: 'select-pane-direction', args: { client: 'client', direction: 'left' } })
  expect(parseCommandLine('toggle-pane-zoom', current)).toEqual({ method: 'toggle-pane-zoom', args: { client: 'client' } })
  expect(parseCommandLine('reopen-closed', current)).toEqual({ method: 'reopen-closed', args: { client: 'client' } })
  expect(parseCommandLine('scroll-half-down', current)).toEqual({ method: 'scroll', args: { pane: window.panes[0].id, action: 'scroll-half-down' } })
  expect(parseCommandLine('move-window-left', current)).toEqual({ method: 'swap-window', args: { client: 'client', direction: -1 } })
  expect(parseCommandLine('move-window-right', current)).toEqual({ method: 'swap-window', args: { client: 'client', direction: 1 } })
  expect(parseCommandLine('move-window-first', current)).toEqual({ method: 'move-window', args: { client: 'client', position: 'first' } })
  expect(parseCommandLine('move-window-last', current)).toEqual({ method: 'move-window', args: { client: 'client', position: 'last' } })
  expect(parseCommandLine('move-window -t 2', current)).toEqual({ method: 'move-window', args: { client: 'client', window: window.id, session: session.id, position: '2' } })
  expect(parseCommandLine('movew -t 2', current)).toEqual({ method: 'move-window', args: { client: 'client', window: window.id, session: session.id, position: '2' } })
  expect(parseCommandLine(':movew first', current)).toEqual({ method: 'move-window', args: { client: 'client', window: window.id, session: session.id, position: 'first' } })
  expect(parseCommandLine('swap-window -t -1', current)).toEqual({ method: 'swap-window', args: { client: 'client', window: window.id, destination: secondWindow.id } })
  expect(parseCommandLine('swap-window -t 2', current).args).toMatchObject({ window: window.id, destination: secondWindow.id })
  expect(parseCommandLine('close-system-window', current)).toEqual({ method: 'detach-client', args: { client: 'client' } })
  expect(parseCommandLine('restore-layout "my layout" --confirm', current)).toMatchObject({ args: { name: 'my layout', confirm: true, window: window.id } })
  expect(() => parseCommandLine('tab select -t 0', current)).toThrow('Unknown command')
  expect(() => parseCommandLine('select-window -t', current)).toThrow('Missing value')
  expect(() => parseCommandLine('not-a-command', current)).toThrow('Unknown command')
})

it('cycles sessions in both directions and wraps at the ends', () => {
  let current = state(), first = current.model.sessions[0]
  let second = newSession('second', first.defaultProfileId)
  let third = newSession('third', first.defaultProfileId)
  current.model.sessions.push(second, third)
  expect(parseCommandLine('next-session', current)).toMatchObject({ method: 'switch-client', args: { client: 'client', session: second.id } })
  expect(parseCommandLine('previous-session', current)).toMatchObject({ args: { session: third.id } })
  current.model.clients[0].sessionId = third.id
  current.model.clients[0].windowId = third.windows[0].id
  expect(parseCommandLine('next-session', current)).toMatchObject({ args: { session: first.id } })
})

it('parses floating pane commands while preserving legacy move targets', () => {
  let current = state(), pane = current.model.sessions[0].windows[0].panes[0]
  expect(parseCommandLine('new-pane --url http://localhost:3000', current)).toMatchObject({ method: 'new-pane', args: { pane: pane.id, url: 'http://localhost:3000' } })
  expect(parseCommandLine('break-pane -W', current)).toMatchObject({ method: 'break-pane', args: { pane: pane.id, floating: true } })
  expect(parseCommandLine('join-pane --destination pane_target -v', current)).toMatchObject({ method: 'join-pane', args: { pane: pane.id, destination: 'pane_target', axis: 'vertical' } })
  expect(parseCommandLine('move-pane -t pane_source --window win_target', current)).toMatchObject({ args: { pane: 'pane_source', window: 'win_target' } })
  expect(parseCommandLine('resize-pane --width 500 --height 300', current)).toMatchObject({ args: { pane: pane.id, width: '500', height: '300' } })
})

it('parses tmux pane command aliases and session targets', () => {
  let current = state(), source = current.model.sessions[0].windows[0].panes[0]
  let destination = newSession('work', current.model.sessions[0].defaultProfileId)
  current.model.sessions.push(destination)
  expect(parseCommandLine('movep -t work', current)).toEqual({ method: 'move-pane', args: { client: 'client', pane: source.id, session: destination.id } })
  expect(parseCommandLine('movep -t work:', current)).toEqual({ method: 'move-pane', args: { client: 'client', pane: source.id, session: destination.id } })
  expect(parseCommandLine(`movep -s ${source.id} -t work:`, current)).toEqual({ method: 'move-pane', args: { client: 'client', pane: source.id, session: destination.id } })
  expect(parseCommandLine(`movep -t ${destination.name}:${destination.windows[0].name}`, current)).toEqual({ method: 'move-pane', args: { client: 'client', pane: source.id, window: destination.windows[0].id } })
  expect(parseCommandLine(`joinp -s ${source.id} -t work -v`, current)).toEqual({ method: 'join-pane', args: { client: 'client', pane: source.id, window: destination.windows[0].id, axis: 'vertical' } })
  expect(parseCommandLine(`joinp -s ${source.id} -t ${destination.windows[0].panes[0].id} -v`, current)).toEqual({ method: 'join-pane', args: { client: 'client', pane: source.id, destination: destination.windows[0].panes[0].id, axis: 'vertical' } })
  expect(parseCommandLine('splitw -h', current)).toMatchObject({ method: 'split-window', args: { pane: source.id, axis: 'horizontal' } })
  expect(parseCommandLine('selectw -t 1', current)).toMatchObject({ method: 'select-window', args: { window: current.model.sessions[0].windows[0].id } })
  expect(parseCommandLine('next', current)).toEqual({ method: 'cycle-window', args: { client: 'client', direction: 1 } })
})

it('resolves omitted session targets only within the current client session', () => {
  let current = state(), other = current.model.sessions[0], session = newSession('current', other.defaultProfileId)
  let destination = session.windows[0], source = newWindow('source', session.defaultProfileId)
  destination.name = 'research'
  other.name = 'research'
  session.windows.push(source)
  current.model.sessions.push(session)
  Object.assign(current.model.clients[0], { sessionId: session.id, windowId: source.id, paneId: source.panes[0].id })
  for (let command of ['joinp', 'join-pane', 'movep', 'move-pane']) {
    for (let target of [':1', ':research', ':res', `:${destination.id}`]) {
      expect(parseCommandLine(`${command} -t ${target}`, current)).toEqual({ method: command.startsWith('join') ? 'join-pane' : 'move-pane', args: { client: 'client', pane: source.panes[0].id, window: destination.id } })
    }
    expect(parseCommandLine(`${command} -s ${other.windows[0].panes[0].id} -t :1`, current).args).toMatchObject({ pane: other.windows[0].panes[0].id, window: destination.id })
  }
})

it('does not fall back to other sessions for missing or ambiguous current-session windows', () => {
  let current = state(), session = current.model.sessions[0]
  current.model.sessions.push(newSession('missing', session.defaultProfileId), newSession('research', session.defaultProfileId), newSession('fourth', session.defaultProfileId))
  session.windows.push(newWindow('research-one', session.defaultProfileId), newWindow('research-two', session.defaultProfileId))
  for (let command of ['joinp', 'movep']) {
    expect(() => parseCommandLine(`${command} -t :missing`, current)).toThrow("Window 'missing' not found")
    expect(() => parseCommandLine(`${command} -t :4`, current)).toThrow("Window '4' not found")
    expect(() => parseCommandLine(`${command} -t :res`, current)).toThrow("Window 'res' is ambiguous")
  }
})

it('resolves explicit session targets and unique prefixes without treating missing sessions as panes', () => {
  let current = state(), source = current.model.clients[0].paneId
  let destination = newSession('bmux-marketing', current.model.sessions[0].defaultProfileId)
  current.model.sessions.push(destination)
  for (let command of ['movep', 'move-pane']) {
    for (let target of ['bmux-marketing:', 'bmux-mar:', `${destination.id}:`, '2:']) {
      expect(parseCommandLine(`${command} -t ${target}`, current)).toEqual({ method: 'move-pane', args: { client: 'client', pane: source, session: destination.id } })
    }
  }
  destination.windows[0].name = 'research'
  expect(parseCommandLine('movep -t bmux-mar:res', current)).toMatchObject({ args: { window: destination.windows[0].id } })
  expect(() => parseCommandLine('movep -t missing:', current)).toThrow("Session 'missing' not found")
  expect(() => parseCommandLine('movep -t bmux-marketing:missing', current)).toThrow("Window 'bmux-marketing:missing' not found")
  expect(() => parseCommandLine('movep -t missing', current)).toThrow("Pane, window, or session 'missing' not found")
  current.model.sessions.push(newSession('bmux-marketplace', destination.defaultProfileId))
  expect(() => parseCommandLine('movep -t bmux-mar:', current)).toThrow("Session 'bmux-mar' is ambiguous")
  expect(parseCommandLine('movep -t bmux-marketing:', current)).toMatchObject({ args: { session: destination.id } })
})

it('parses Bitwarden fill, lock, and tab-scoped cancellation', () => {
  let current = state(), tab = current.model.sessions[0].windows[0].panes[0].id
})

it('parses extension management commands for the selected pane or an explicit profile', () => {
  let current = state(), pane = current.model.sessions[0].windows[0].panes[0]
  for (let action of ['enable', 'disable', 'remove', 'options']) {
    expect(parseCommandLine(`extension ${action} "Fixture extension"`, current)).toMatchObject({ method: `extension.${action}`, args: { pane: pane.id, id: 'Fixture extension' } })
    expect(parseCommandLine(`extension ${action} fixture-id --profile other`, current)).toMatchObject({ method: `extension.${action}`, args: { profile: 'other', id: 'fixture-id' } })
  }
})

it('resolves pane coordinates, active panes, and relative windows for movement and selection', () => {
  let current = state(), session = current.model.sessions[0], first = session.windows[0]
  let second = newWindow('second', session.defaultProfileId, false, current.model)
  session.windows.push(second)
  let extra = newPane(session.defaultProfileId, 'about:blank', current.model)
  first.panes.push(extra); first.layout = splitLayout(first.layout, first.panes[0].id, extra.id, 'vertical')
  current.model.clients[0].paneId = extra.id
  expect(parseCommandLine('joinp -bdh -s :2.0 -t :1.1', current)).toEqual({ method: 'join-pane', args: { client: 'client', pane: second.panes[0].id, destination: extra.id, before: true, background: true, axis: 'horizontal' } })
  expect(parseCommandLine('joinp -s :2', current).args).toMatchObject({ pane: second.panes[0].id, destination: extra.id })
  expect(parseCommandLine('joinp -s:2.0 -t:1.0', current).args).toMatchObject({ pane: second.panes[0].id, destination: first.panes[0].id })
  expect(parseCommandLine('selectp -t .0', current).args).toMatchObject({ pane: first.panes[0].id })
  expect(parseCommandLine('selectw -t :+1', current).args).toMatchObject({ window: second.id })
  expect(parseCommandLine('selectw -t :{end}', current).args).toMatchObject({ window: second.id })
  expect(parseCommandLine('swapp -U -t .0', current).args).toMatchObject({ pane: extra.id, destination: first.panes[0].id })
  expect(parseCommandLine('rotatew -U -t :1', current).args).toMatchObject({ window: first.id, direction: -1 })
  expect(() => parseCommandLine('joinp -s :1.8 -t :2', current)).toThrow("Pane '8' not found")
  expect(() => parseCommandLine('joinp -l 50% -t :2', current)).toThrow('Unsupported option')
  expect(() => parseCommandLine('joinp :2', current)).toThrow('does not accept positional targets')
  expect(parseCommandLine('joinp --background=false -t :2', current).args).toMatchObject({ background: false })
})

it('breaks panes into a specified session and index and transfers or swaps explicit windows', () => {
  let current = state(), session = current.model.sessions[0], source = session.windows[0], work = newSession('work', session.defaultProfileId, false, current.model)
  current.model.sessions.push(work)
  expect(parseCommandLine('breakp -s :1.0 -t work:2 -n notes -d', current)).toEqual({ method: 'break-pane', args: { client: 'client', pane: source.panes[0].id, session: work.id, position: '2', name: 'notes', background: true } })
  expect(parseCommandLine('break-pane -t work: -s :1 -W', current).args).toMatchObject({ pane: source.panes[0].id, floating: true })
  expect(parseCommandLine('movew -s work:1 -t :1 -b -d', current).args).toEqual({ client: 'client', window: work.windows[0].id, session: session.id, position: '1', before: true, background: true })
  expect(parseCommandLine('swapw -s :1 -t work:1 -d', current).args).toEqual({ client: 'client', window: source.id, destination: work.windows[0].id, background: true })
  expect(() => parseCommandLine('movew -b -a -t :1', current)).toThrow('Use either -b or -a')
  expect(() => parseCommandLine('rotatew -U -D', current)).toThrow('Use either -U or -D')
  current.model.clients.push({ ...current.model.clients[0], id: 'other', sessionId: work.id, windowId: work.windows[0].id, paneId: work.windows[0].panes[0].id })
  expect(parseCommandLine('joinp -c other -t :1', current).args).toMatchObject({ client: 'other', pane: work.windows[0].panes[0].id, window: work.windows[0].id })
})

it('gives numeric window indices priority over numeric names and selects a session current window', () => {
  let current = state(), session = current.model.sessions[0], first = session.windows[0]
  let second = newWindow('1', session.defaultProfileId, false, current.model)
  session.windows.push(second)
  expect(parseCommandLine('joinp -t :1', current).args).toMatchObject({ window: first.id })
  expect(parseCommandLine('joinp -t :=1', current).args).toMatchObject({ window: second.id })
  current.model.clients[0].windowId = second.id; current.model.clients[0].paneId = second.panes[0].id
  expect(parseCommandLine(`joinp -t ${session.name}:`, current).args).toMatchObject({ window: second.id })
  expect(parseCommandLine('selectw -t :', current).args).toMatchObject({ window: second.id })
  expect(() => parseCommandLine('selectw -t :missing', current)).toThrow("Window 'missing' not found")
})
