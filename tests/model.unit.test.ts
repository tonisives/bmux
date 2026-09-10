import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cloneWindow, initialModel, mapLayout, newPane, removePane, splitLayout, validateModel } from '../src/main/model'
import { readModel, writeModel } from '../src/main/store'

describe('session layouts and persistence', () => {
  it('collapses a removed nested pane without losing its siblings or split ratios', () => {
    let tree = splitLayout(null, '', 'a', 'horizontal')
    tree = splitLayout(tree, 'a', 'b', 'horizontal')
    tree = splitLayout(tree, 'b', 'c', 'vertical')
    let kept = removePane(tree, 'b')
    expect(kept).toMatchObject({ kind: 'split', axis: 'horizontal', first: { paneId: 'a' }, second: { paneId: 'c' } })
    expect(removePane(removePane(kept, 'a'), 'c')).toBeNull()
  })
  it('clones mixed-profile layouts with fresh page IDs and preserves the selected tabs', () => {
    let model = initialModel()
    let window = model.sessions[0].windows[0]
    let bot = newPane('profile_bot', 'https://example.com')
    window.layout = splitLayout(window.layout, window.panes[0].id, bot.id, 'vertical')
    window.panes.push(bot)
    let clone = cloneWindow(window)
    expect(clone.panes.map(pane => pane.profileId)).toEqual(['profile_default', 'profile_bot'])
    expect(clone.panes[1].tabs[0].url).toBe('https://example.com')
    expect(clone.panes[1].activeTabId).toBe(clone.panes[1].tabs[0].id)
    expect(clone.panes[1].id).not.toBe(bot.id)
    expect(clone.panes[1].tabs[0].id).not.toBe(bot.tabs[0].id)
    let leaves: string[] = []
    mapLayout(clone.layout, node => { if (node.kind === 'pane') leaves.push(node.paneId); return node })
    expect(leaves).toEqual(clone.panes.map(pane => pane.id))
  })
  it('round-trips state atomically and refuses corrupt state without replacing it', () => {
    let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browmux-unit-'))
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
  it('rejects a layout that points to the wrong pane', () => {
    let model = initialModel()
    model.sessions[0].windows[0].layout = { kind: 'pane', paneId: 'missing' }
    expect(() => validateModel(model)).toThrow('Invalid pane')
  })
})
