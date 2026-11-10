import { describe, expect, it } from 'vitest'
import { initialModel } from '../src/main/model'
import { lockedPaneInventory } from '../src/main/locked-pane-inventory'

describe('locked pane inventory', () => {
  it('reports fixed identities without page content, browsing history or proxy endpoints', () => {
    let model = initialModel(), session = model.sessions[0], window = session.windows[0], pane = window.panes[0]
    window.locked = true; window.lockedViewports = { [pane.id]: { width: 1512, height: 900 } }
    pane.url = 'https://www.tiktok.com/@someone-else/video/1'; pane.title = 'Private page title'
    model.profiles[0].proxy = { protocol: 'https', host: 'private-proxy.example', port: 443, authenticated: true }
    model.profiles[0].history = [{ url: 'https://private-history.example', title: 'Private history', visitedAt: 1 }]
    let inventory = lockedPaneInventory(model)
    expect(inventory).toHaveLength(1)
    expect(inventory[0].identity.network).toBe('proxy')
    expect(inventory[0].identity.viewport).toEqual({ width: 1512, height: 900 })
    expect(inventory[0].identity.settingsHash).toMatch(/^[a-f0-9]{64}$/)
    for (let value of ['someone-else', 'Private page title', 'private-proxy', 'private-history']) expect(JSON.stringify(inventory)).not.toContain(value)
    let fingerprint = inventory[0].identity.settingsHash
    model.profiles[0].proxy.port = 444
    expect(lockedPaneInventory(model)[0].identity.settingsHash).not.toBe(fingerprint)
  })
  it('omits unlocked, private and transient workspaces and unsupported websites', () => {
    let model = initialModel(), session = model.sessions[0], window = session.windows[0], pane = window.panes[0]
    pane.url = 'https://youtube.com/watch?v=fixture'
    expect(lockedPaneInventory(model)).toEqual([])
    window.locked = true; window.lockedViewports = { [pane.id]: { width: 1512, height: 900 } }
    session.private = true; expect(lockedPaneInventory(model)).toEqual([])
    session.private = false; session.ephemeral = true; expect(lockedPaneInventory(model)).toEqual([])
    session.ephemeral = false; pane.url = 'https://example.com'; expect(lockedPaneInventory(model)).toEqual([])
  })
})
