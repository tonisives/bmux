import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { cloneWindow, initialModel, mapLayout, newPane, newSession, paneInDirection, removePane, removeSession, repairClientSelections, newWindow, splitLayout, updateAutomaticWindowName, validateModel } from '../src/main/model'
import { readModel, writeModel } from '../src/main/store'

describe('session layouts and persistence', () => {
  it('selects the nearest pane in each visual direction', () => {
    let tree = splitLayout(null, '', 'left', 'horizontal')
    tree = splitLayout(tree, 'left', 'top-right', 'horizontal')
    tree = splitLayout(tree, 'top-right', 'bottom-right', 'vertical')
    expect(paneInDirection(tree, 'left', 'right')).toBe('top-right')
    expect(paneInDirection(tree, 'top-right', 'down')).toBe('bottom-right')
    expect(paneInDirection(tree, 'bottom-right', 'left')).toBe('left')
    expect(paneInDirection(tree, 'left', 'up')).toBeUndefined()
  })
  it('collapses a removed nested pane without losing its siblings or split ratios', () => {
    let tree = splitLayout(null, '', 'a', 'horizontal')
    tree = splitLayout(tree, 'a', 'b', 'horizontal')
    tree = splitLayout(tree, 'b', 'c', 'vertical')
    let kept = removePane(tree, 'b')
    expect(kept).toMatchObject({ kind: 'split', axis: 'horizontal', first: { paneId: 'a' }, second: { paneId: 'c' } })
    expect(removePane(removePane(kept, 'a'), 'c')).toBeNull()
  })
  it('can place a new pane before its split target', () => {
    let tree = splitLayout(null, '', 'right', 'horizontal')
    tree = splitLayout(tree, 'right', 'left', 'horizontal', true)
    expect(tree).toMatchObject({ kind: 'split', axis: 'horizontal', first: { paneId: 'left' }, second: { paneId: 'right' } })
  })
  it('clones mixed-profile layouts with fresh pane IDs and preserves opener links', () => {
    let model = initialModel()
    let window = model.sessions[0].windows[0]
    let bot = newPane('profile_bot', 'https://example.com')
    bot.openerPaneId = window.panes[0].id
    window.layout = splitLayout(window.layout, window.panes[0].id, bot.id, 'vertical')
    window.panes.push(bot)
    let clone = cloneWindow(window)
    expect(clone.panes.map(pane => pane.profileId)).toEqual(['profile_default', 'profile_bot'])
    expect(clone.panes[1].url).toBe('https://example.com')
    expect(clone.panes[1].openerPaneId).toBe(clone.panes[0].id)
    expect(clone.panes[1].id).not.toBe(bot.id)
    let leaves: string[] = []
    mapLayout(clone.layout, node => { if (node.kind === 'pane') leaves.push(node.paneId); return node })
    expect(leaves).toEqual(clone.panes.map(pane => pane.id))
  })
  it('names automatic windows from the selected pane, preserving explicit names', () => {
    let window = initialModel().sessions[0].windows[0]
    window.panes[0].url = 'https://www.example.com/first'
    expect(updateAutomaticWindowName(window)).toBe(true)
    expect(window.name).toBe('example.com')
    window.panes[0].url = 'https://docs.example.test/latest'
    updateAutomaticWindowName(window)
    expect(window.name).toBe('docs.example.test')
    let second = newPane('profile_default', 'https://second.test')
    window.panes.push(second)
    updateAutomaticWindowName(window)
    expect(window.name).toBe('docs.example.test')
    updateAutomaticWindowName(window, second.id)
    expect(window.name).toBe('second.test')
    let pane = newPane('profile_default', 'https://third.test')
    window.panes.push(pane)
    updateAutomaticWindowName(window, pane.id)
    expect(window.name).toBe('third.test')
    window.name = 'research'; window.automaticName = false
    updateAutomaticWindowName(window, window.panes[0].id)
    expect(window.name).toBe('research')
  })
  it('round-trips state atomically and refuses corrupt state without replacing it', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-unit-'))
    try {
      let model = initialModel()
      model.sessions[0].name = 'persistent'
      writeModel(directory, model)
      expect(readModel(directory)).toEqual(model)
      expect(fs.existsSync(path.join(directory, 'state.json.tmp'))).toBe(false)
      fs.writeFileSync(path.join(directory, 'state.json'), '{broken')
      expect(() => readModel(directory)).toThrow()
      expect(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).toBe('{broken')
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('migrates hidden legacy tabs into separate windows without dropping pages', () => {
    let old = initialModel() as unknown as { version: number; sessions: { windows: { panes: Record<string, unknown>[] }[] }[] }
    let pane = old.sessions[0].windows[0].panes[0]
    let paneId = pane.id
    old.version = 1
    old.sessions[0].windows[0].panes[0] = { id: paneId, profileId: 'profile_default', activeTabId: 'tab_active', tabs: [
      { id: 'tab_active', url: 'https://active.test', title: 'Active', zoom: 1 },
      { id: 'tab_hidden', url: 'https://hidden.test', title: 'Hidden', zoom: 1, keepAlive: true, openerTabId: 'tab_active' },
    ] }
    let upgraded = validateModel(old)
    expect(upgraded.version).toBe(2)
    expect(upgraded.sessions[0].windows).toHaveLength(2)
    expect(upgraded.sessions[0].windows[0].panes[0]).toMatchObject({ id: paneId, url: 'https://active.test' })
    let restored = upgraded.sessions[0].windows[1].panes[0]
    expect(restored).toMatchObject({ url: 'https://hidden.test', keepAlive: true, openerPaneId: paneId })
    expect(restored.id).toMatch(/^pane_/)
    expect('tabs' in restored).toBe(false)
  })
  it('backs up and persists the migrated state so new pane IDs remain stable', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-migrate-unit-'))
    try {
      let old = initialModel() as unknown as { version: number; sessions: { windows: { panes: Record<string, unknown>[] }[] }[] }
      let pane = old.sessions[0].windows[0].panes[0]
      old.version = 1
      old.sessions[0].windows[0].panes[0] = { id: pane.id, profileId: 'profile_default', activeTabId: 'tab_one', tabs: [
        { id: 'tab_one', url: 'about:blank', title: 'One', zoom: 1 },
        { id: 'tab_two', url: 'https://two.test', title: 'Two', zoom: 1 },
      ] }
      let source = JSON.stringify(old)
      fs.writeFileSync(path.join(directory, 'state.json'), source)
      let first = readModel(directory)
      expect(readModel(directory)).toEqual(first)
      expect(fs.readFileSync(path.join(directory, 'state.json.v1-backup'), 'utf8')).toBe(source)
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).version).toBe(2)
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('keeps private sessions and their client selections out of saved state', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-private-unit-'))
    try {
      let model = initialModel(), privateSession = newSession('secret', model.profiles[0].id, true)
      model.sessions.push(privateSession)
      model.clients.push({ id: 'private_client', sessionId: privateSession.id, windowId: privateSession.windows[0].id, paneId: privateSession.windows[0].panes[0].id, width: 800, height: 600, sessionHistory: [privateSession.id, model.sessions[0].id] })
      writeModel(directory, model)
      let saved = fs.readFileSync(path.join(directory, 'state.json'), 'utf8')
      expect(saved).not.toContain('secret')
      expect(saved).not.toContain(privateSession.id)
      expect(saved).not.toContain('private_client')
      expect(readModel(directory).sessions).toEqual([model.sessions[0]])
      model.sessions.shift()
      writeModel(directory, model)
      expect(readModel(directory).sessions[0]).toMatchObject({ name: 'main', defaultProfileId: model.profiles[0].id })
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('stores bookmarks beside config and migrates embedded state bookmarks', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-bookmarks-unit-'))
    let bookmarkFile = path.join(directory, 'config', 'bookmarks.yaml')
    try {
      let model = initialModel()
      let bookmarks = [{ id: 'folder', title: 'Work', children: [{ id: 'page', title: 'Example', url: 'https://example.test' }] }]
      model.profiles[0].bookmarks = bookmarks
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(model))
      expect(readModel(directory, bookmarkFile).profiles[0].bookmarks).toEqual(bookmarks)
      expect(parseYaml(fs.readFileSync(bookmarkFile, 'utf8')).profiles.profile_default).toEqual(bookmarks)
      let restored = readModel(directory, bookmarkFile)
      restored.profiles[0].bookmarks = [{ id: 'new', title: 'Updated', url: 'https://updated.test' }]
      writeModel(directory, restored, bookmarkFile)
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).profiles[0]).not.toHaveProperty('bookmarks')
      expect(readModel(directory, bookmarkFile).profiles[0].bookmarks).toEqual(restored.profiles[0].bookmarks)
      let annotated = `# My bookmark list\n${fs.readFileSync(bookmarkFile, 'utf8')}`
      fs.writeFileSync(bookmarkFile, annotated)
      writeModel(directory, restored, bookmarkFile)
      expect(fs.readFileSync(bookmarkFile, 'utf8')).toBe(annotated)
      expect(fs.existsSync(`${bookmarkFile}.tmp`)).toBe(false)
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('uses edited YAML over old state and leaves invalid YAML untouched', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-bookmarks-unit-'))
    let bookmarkFile = path.join(directory, 'bookmarks.yaml')
    try {
      let model = initialModel()
      model.profiles[0].bookmarks = [{ id: 'old', title: 'Old', url: 'https://old.test' }]
      fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(model))
      let edited = 'profiles:\n  profile_default:\n    - id: edited\n      title: Edited\n      url: https://edited.test\n'
      fs.writeFileSync(bookmarkFile, edited)
      expect(readModel(directory).profiles[0].bookmarks?.[0].id).toBe('edited')
      fs.writeFileSync(bookmarkFile, 'profiles: [broken')
      expect(() => readModel(directory)).toThrow('Invalid YAML in bookmarks file')
      expect(fs.readFileSync(bookmarkFile, 'utf8')).toBe('profiles: [broken')
      expect(JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')).profiles[0].bookmarks[0].id).toBe('old')
    } finally { fs.rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects a layout that points to the wrong pane', () => {
    let model = initialModel()
    model.sessions[0].windows[0].layout = { kind: 'pane', paneId: 'missing' }
    expect(() => validateModel(model)).toThrow('Invalid pane')
  })
})

it('returns each client to its most recently visited surviving window after closing', () => {
  let model = initialModel(), session = model.sessions[0]
  let first = session.windows[0], second = newWindow('second', session.defaultProfileId), third = newWindow('third', session.defaultProfileId)
  session.windows.push(second, third)
  model.clients = [first, second].map((window, index) => ({ id: `client_${index}`, sessionId: session.id, windowId: window.id, paneId: window.panes[0].id, width: 800, height: 600 }))
  repairClientSelections(model)
  let [client, other] = model.clients
  client.windowId = third.id
  repairClientSelections(model)
  client.windowId = second.id
  repairClientSelections(model)
  repairClientSelections(model)
  session.windows = session.windows.filter(window => window !== second)
  repairClientSelections(model)
  expect(client.windowId).toBe(third.id)
  expect(client.paneId).toBe(third.panes[0].id)
  expect(other.windowId).toBe(first.id)
  session.windows = session.windows.filter(window => window !== third)
  repairClientSelections(model)
  expect(client.windowId).toBe(first.id)
  expect(client.windowHistory).toEqual([first.id])
})

it('keeps each client session history ordered by most recent selection', () => {
  let model = initialModel(), first = model.sessions[0], second = newSession('second', first.defaultProfileId)
  model.sessions.push(second)
  let client = { id: 'client', sessionId: first.id, windowId: first.windows[0].id, paneId: first.windows[0].panes[0].id, width: 800, height: 600 }
  model.clients.push(client)
  repairClientSelections(model)
  expect(model.clients[0].sessionHistory).toEqual([first.id])
  client.sessionId = second.id
  repairClientSelections(model)
  expect(model.clients[0].sessionHistory).toEqual([second.id, first.id])
  client.sessionId = first.id
  repairClientSelections(model)
  expect(model.clients[0].sessionHistory).toEqual([first.id, second.id])
})

it('removes a session and advances its clients to the next session', () => {
  let model = initialModel(), first = model.sessions[0], second = newSession('second', first.defaultProfileId), third = newSession('third', first.defaultProfileId)
  model.sessions.push(second, third)
  model.clients = [{ id: 'client', sessionId: second.id, windowId: second.windows[0].id, paneId: second.windows[0].panes[0].id, width: 800, height: 600 }]
  expect(removeSession(model, second)).toBe(third)
  expect(model.sessions).toEqual([first, third])
  expect(model.clients[0]).toMatchObject({ sessionId: third.id, windowId: third.windows[0].id, paneId: third.windows[0].panes[0].id })
})

it('replaces the only removed session with a fresh main session', () => {
  let model = initialModel(), removed = model.sessions[0]
  let next = removeSession(model, removed)
  expect(model.sessions).toEqual([next])
  expect(next.id).not.toBe(removed.id)
  expect(next.name).toBe('main')
})

it('remembers a closed session profile across state saves without recording private sessions', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-closed-profile-'))
  try {
    let model = initialModel(), work = newSession('work', 'profile_bot'), privateSession = newSession('secret', 'profile_bot', true)
    model.sessions.push(work, privateSession)
    removeSession(model, work)
    removeSession(model, privateSession)
    expect(model.closedSessionProfiles).toEqual({ work: 'profile_bot' })
    writeModel(directory, model)
    expect(readModel(directory).closedSessionProfiles).toEqual({ work: 'profile_bot' })
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

it('persists the profile used for new sessions', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-new-session-profile-'))
  try {
    let model = initialModel()
    model.newSessionProfileId = 'profile_bot'
    writeModel(directory, model)
    expect(readModel(directory).newSessionProfileId).toBe('profile_bot')
    model.newSessionProfileId = 'missing'
    expect(() => validateModel(model)).toThrow('Invalid new session profile')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
