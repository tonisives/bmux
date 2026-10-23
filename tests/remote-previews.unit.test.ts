import { expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRemotePreviews } from '../src/main/remote-previews'
import type { Host } from '../remote/web/client'

let listing = (id: string, privateSession?: boolean): Host => ({ id, key: { x: `key-${id}` }, generation: 'generation', service: 'fixture', permission: 'watch', sessions: [{ id: 'session', name: 'main', private: privateSession, panes: [{ id: 'pane', title: 'Page' }] }] })
let image = 'data:image/jpeg;base64,Zmlyc3Q='
it('restores viewed frames separately for hosts and removes closed or rekeyed sessions', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-previews-'))
  try {
    let hosts = [listing('one', false), listing('two', false)], cache = createRemotePreviews(directory)
    await cache.reconcile(hosts)
    await cache.set('one', 'session', 'pane', image)
    await cache.set('two', 'session', 'pane', 'data:image/jpeg;base64,c2Vjb25k')
    await cache.flush()
    let restored = createRemotePreviews(directory)
    await restored.reconcile(hosts)
    expect((await restored.get('one', 'session')).pane.image).toBe(image)
    expect((await restored.get('two', 'session')).pane.image).toBe('data:image/jpeg;base64,c2Vjb25k')
    hosts[0].key.x = 'replacement'
    await restored.reconcile([hosts[0]])
    expect(await restored.get('one', 'session')).toEqual({})
    expect(await restored.get('two', 'session')).toEqual({})
    await restored.flush()
    expect(await fs.readdir(path.join(directory, 'previews'))).toEqual([])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
it('keeps private and legacy frames in memory and ignores panes outside the selected session', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-remote-previews-'))
  try {
    let hosts = [listing('private', true), listing('legacy')], cache = createRemotePreviews(directory)
    await cache.reconcile(hosts)
    await cache.set('private', 'session', 'pane', image)
    await cache.set('legacy', 'session', 'pane', image)
    await cache.set('private', 'other-session', 'pane', image)
    await cache.set('private', 'session', 'other-pane', image)
    expect((await cache.get('private', 'session')).pane.image).toBe(image)
    expect(await cache.get('private', 'other-session')).toEqual({})
    await expect(cache.set('private', 'session', 'pane', 'invalid')).rejects.toThrow('Invalid remote preview')
    await cache.flush()
    expect(await fs.readdir(directory)).toEqual([])
    let restored = createRemotePreviews(directory)
    await restored.reconcile(hosts)
    expect(await restored.get('private', 'session')).toEqual({})
    await cache.reconcile([])
    expect(await cache.get('legacy', 'session')).toEqual({})
    await cache.flush()
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
