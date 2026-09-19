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
  it('clones mixed-profile layouts with fresh page IDs and preserves the selected tabs', () => {
    let model = initialModel()
    let window = model.sessions[0].windows[0]
    let bot = newPane('profile_bot', 'https://example.com')
    bot.tabs.push({ id: 'tab_popup', url: 'https://example.com/popup', title: 'Popup', zoom: 1, openerTabId: bot.tabs[0].id })
    bot.activeTabId = 'tab_popup'
    window.layout = splitLayout(window.layout, window.panes[0].id, bot.id, 'vertical')
    window.panes.push(bot)
    let clone = cloneWindow(window)
    expect(clone.panes.map(pane => pane.profileId)).toEqual(['profile_default', 'profile_bot'])
    expect(clone.panes[1].tabs[0].url).toBe('https://example.com')
    expect(clone.panes[1].activeTabId).toBe(clone.panes[1].tabs[1].id)
    expect(clone.panes[1].tabs[1].openerTabId).toBe(clone.panes[1].tabs[0].id)
    expect(clone.panes[1].id).not.toBe(bot.id)
    expect(clone.panes[1].tabs[0].id).not.toBe(bot.tabs[0].id)
    let leaves: string[] = []
    mapLayout(clone.layout, node => { if (node.kind === 'pane') leaves.push(node.paneId); return node })
    expect(leaves).toEqual(clone.panes.map(pane => pane.id))
  })
  it('names automatic windows from the selected pane and tab, preserving explicit names', () => {
    let window = initialModel().sessions[0].windows[0]
    window.panes[0].tabs[0].url = 'https://www.example.com/first'
    expect(updateAutomaticWindowName(window)).toBe(true)
    expect(window.name).toBe('example.com')
    window.panes[0].tabs[0].url = 'https://docs.example.test/latest'
    updateAutomaticWindowName(window)
    expect(window.name).toBe('docs.example.test')
    window.panes[0].tabs.push({ id: 'tab_second', url: 'https://second.test', title: 'Second', zoom: 1 })
    updateAutomaticWindowName(window)
    expect(window.name).toBe('docs.example.test')
    window.panes[0].activeTabId = 'tab_second'
    updateAutomaticWindowName(window)
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
