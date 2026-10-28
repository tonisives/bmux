import { expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initialModel, newPane, newSession, newWindow, repairClientSelections } from '../src/main/model'
import { readModel, writeModel } from '../src/main/store'
import { latestLocalSession, projectRemoteWorkspace, remoteWorkspaceId, remoteWorkspaceMutation, remoteWorkspaceShortcut, remoteWorkspaceTargets } from '../src/shared/remote-workspace'
import type { RemoteWorkspaceSnapshot } from '../src/shared/remote'

let fixture = () => {
  let model = initialModel(), session = model.sessions[0], window = session.windows[0], first = window.panes[0]
  window.number = 7
  window.pinned = true
  let second = newPane(session.defaultProfileId, 'https://fixture.test/second', model)
  window.panes.push(second)
  let floating = newPane(session.defaultProfileId, 'https://fixture.test/float', model)
  window.panes.push(floating)
  window.layout = { kind: 'split', id: 'host-split', axis: 'vertical', ratio: .3, first: { kind: 'pane', paneId: first.id }, second: { kind: 'pane', paneId: second.id } }
  window.floating = [{ paneId: floating.id, x: 42, y: 53, width: 400, height: 300, dock: { siblingIds: [first.id], axis: 'horizontal', ratio: .5, before: false } }]
  let snapshot: RemoteWorkspaceSnapshot = { session, profiles: [{ id: session.defaultProfileId, name: 'Host profile' }], selection: { windowId: window.id, paneId: second.id } }
  let source = { clientId: 'viewer-one', hostId: 'host', sessionId: session.id, generation: 'generation' }
  return { model, session, window, snapshot, source }
}
it('projects host window numbers, splits, floating panes and private state with per-client identities', () => {
  let { snapshot, source, window } = fixture()
  snapshot.session.private = true
  window.lockedViewports = { [window.panes[0].id]: { width: 900, height: 600 } }
  let first = projectRemoteWorkspace(snapshot, source, 'local-profile'), second = projectRemoteWorkspace(snapshot, { ...source, clientId: 'viewer-two' }, 'local-profile')
  expect(first).toMatchObject({ name: snapshot.session.name, ephemeral: true, private: true, remote: source, defaultProfileId: 'local-profile' })
  expect(first.windows[0]).toMatchObject({ number: 7, pinned: true, layout: { kind: 'split', axis: 'vertical', ratio: .3 }, floating: [{ x: 42, y: 53, width: 400, height: 300 }] })
  expect(first.windows[0].layout).toMatchObject({ id: remoteWorkspaceId(source.clientId, 'split', 'host-split'), first: { paneId: first.windows[0].panes[0].id }, second: { paneId: first.windows[0].panes[1].id } })
  expect(first.windows[0].floating![0]).toMatchObject({ paneId: first.windows[0].panes[2].id, dock: { siblingIds: [first.windows[0].panes[0].id] } })
  expect(first.windows[0].panes.every(pane => pane.profileId === 'local-profile')).toBe(true)
  expect(first.id).not.toBe(second.id)
  expect(first.windows[0].id).not.toBe(second.windows[0].id)
  expect(first.windows[0].panes[0].id).not.toBe(second.windows[0].panes[0].id)
  expect(window.layout).toMatchObject({ id: 'host-split' })
  expect(first.windows[0].lockedViewports).toBeUndefined()
})
it('returns OS links to the latest surviving local session, including a local session named remote', () => {
  let { model, snapshot, source } = fixture(), local = newSession('remote', model.profiles[0].id, false, model)
  model.sessions.push(local)
  let remote = projectRemoteWorkspace(snapshot, source, model.profiles[0].id)
  model.sessions.push(remote)
  let client = { id: source.clientId, sessionId: remote.id, windowId: remote.windows[0].id, paneId: remote.windows[0].panes[0].id, width: 1000, height: 700, sessionHistory: [remote.id, 'deleted-session', local.id, model.sessions[0].id] }
  expect(latestLocalSession(model, client)).toBe(local)
  model.sessions = model.sessions.filter(session => session !== local)
  expect(latestLocalSession(model, client)).toBe(model.sessions[0])
})
it('restores a remote client to Local on restart without persisting any host IDs or panes', () => {
  let { model, snapshot, source } = fixture(), local = model.sessions[0]
  let latestWindow = newWindow('Latest local window', local.defaultProfileId, false, model)
  local.windows.push(latestWindow)
  let remote = projectRemoteWorkspace(snapshot, source, model.profiles[0].id)
  model.sessions.push(remote)
  model.clients.push({ id: source.clientId, sessionId: remote.id, sessionHistory: [remote.id, local.id], windowId: remote.windows[0].id, windowHistory: [remote.windows[0].id, latestWindow.id, local.windows[0].id], paneId: remote.windows[0].panes[0].id, width: 1000, height: 700 })
  model.lastFocusedClientId = source.clientId
  repairClientSelections(model)
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-remote-workspace-unit-'))
  try {
    writeModel(directory, model)
    let restored = readModel(directory)
    expect(restored.sessions).toHaveLength(1)
    expect(restored.clients[0]).toMatchObject({ id: source.clientId, sessionId: local.id, windowId: latestWindow.id })
    expect(restored.lastFocusedClientId).toBe(source.clientId)
    expect(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).not.toContain('remote:viewer-one:')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
it('identifies remote destinations as well as sources before applying structural commands', () => {
  let { model, snapshot, source } = fixture(), remote = projectRemoteWorkspace(snapshot, source, model.profiles[0].id)
  model.sessions.push(remote)
  expect(remoteWorkspaceTargets(model, { pane: model.sessions[0].windows[0].panes[0].id, destination: remote.windows[0].panes[0].id })).toEqual([remote])
  expect(remoteWorkspaceTargets(model, { window: model.sessions[0].windows[0].id, session: remote.id })).toEqual([remote])
  for (let command of ['new-session', 'new-window', 'split-window', 'move-pane', 'reopen-closed', 'restore-layout', 'float.bounds', 'lock-window', 'unlock-window', 'lock-viewport', 'unlock-viewport']) expect(remoteWorkspaceMutation(command), command).toBe(true)
  for (let shortcut of ['split-right', 'new-client', 'close-pane-or-window', 'rename-window', 'layout-tiled']) expect(remoteWorkspaceShortcut(shortcut), shortcut).toBe(true)
  for (let command of ['select-window', 'cycle-pane', 'toggle-pane-zoom', 'remote.action', 'navigate']) expect(remoteWorkspaceMutation(command), command).toBe(false)
})
