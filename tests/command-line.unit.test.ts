import { expect, it } from 'vitest'
import { initialModel, newSession } from '../src/main/model'
import { parseCommandLine, tokenize } from '../src/shared/command-line'
import type { PublicState } from '../src/shared/types'

let state = (): PublicState => {
  let model = initialModel(), session = model.sessions[0], window = session.windows[0], pane = window.panes[0]
  model.clients.push({ id: 'client', sessionId: session.id, windowId: window.id, paneId: pane.id, width: 1280, height: 850 })
  return { model, clientId: 'client', focusedClientId: 'client', snapshots: {}, crashes: {}, loading: {}, permissions: [], downloads: [] }
}
it('parses quoted names and URL arguments without shell interpretation', () => {
  expect(tokenize(':new-session -s "work space" --profile professional')).toEqual(['new-session', '-s', 'work space', '--profile', 'professional'])
  let current = state()
  expect(parseCommandLine('open https://example.test/?a=1&b=$HOME', current)).toEqual({ method: 'navigate', args: { tab: current.model.sessions[0].windows[0].panes[0].activeTabId, url: 'https://example.test/?a=1&b=$HOME' } })
  expect(parseCommandLine('new-session -s "work space" --profile professional', current)).toMatchObject({ method: 'new-session', args: { name: 'work space', client: 'client', profile: 'professional' } })
  expect(() => tokenize('open "unfinished')).toThrow('Unfinished quote')
})
it('resolves current targets, numeric indices, and confirmation flags', () => {
  let current = state(), window = current.model.sessions[0].windows[0]
  expect(parseCommandLine('select-window -t 0', current)).toMatchObject({ args: { window: window.id } })
  expect(parseCommandLine('split-window -v --profile bot', current)).toMatchObject({ args: { pane: window.panes[0].id, axis: 'vertical', profile: 'bot' } })
  expect(parseCommandLine('pane-left', current)).toEqual({ method: 'select-pane-direction', args: { client: 'client', direction: 'left' } })
  expect(parseCommandLine('toggle-pane-zoom', current)).toEqual({ method: 'toggle-pane-zoom', args: { client: 'client' } })
  expect(parseCommandLine('restore-layout "my layout" --confirm', current)).toMatchObject({ args: { name: 'my layout', confirm: true, window: window.id } })
  expect(parseCommandLine('tab select -t 0', current)).toMatchObject({ args: { tab: window.panes[0].activeTabId } })
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
