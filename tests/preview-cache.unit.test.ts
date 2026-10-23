import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createPreviewCache } from '../src/main/preview-cache'

let directories: string[] = []
let directory = async () => { let value = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-previews-')); directories.push(value); return value }
let owner = { paneId: '%1', windowId: 'window-one', profileId: 'default', persistent: true }
let snapshot = { image: 'data:image/jpeg;base64,aGVsbG8=', capturedAt: 1234 }
afterEach(async () => { for (let directory of directories) await fs.rm(directory, { recursive: true, force: true }); directories = [] })

it('restores the last saved page preview without loading a page', async () => {
  let location = await directory(), cache = createPreviewCache(location)
  await cache.restore([owner]); cache.set(owner.paneId, snapshot); await cache.flush()
  let reopened = createPreviewCache(location)
  await reopened.restore([owner])
  expect(reopened.snapshots).toEqual({ [owner.paneId]: snapshot })
})

it('removes closed windows after queued writes and permits pane ID reuse', async () => {
  let location = await directory(), cache = createPreviewCache(location)
  await cache.restore([owner]); cache.set(owner.paneId, snapshot)
  cache.reconcile([]); await cache.flush()
  expect(cache.snapshots).toEqual({})
  expect(await fs.readdir(path.join(location, 'previews'))).toEqual([])
  cache.reconcile([{ ...owner, windowId: 'window-two' }]); cache.set(owner.paneId, { ...snapshot, capturedAt: 5678 }); await cache.flush()
  let reopened = createPreviewCache(location)
  await reopened.restore([{ ...owner, windowId: 'window-two' }])
  expect(reopened.snapshots[owner.paneId].capturedAt).toBe(5678)
})

it('prunes stale owners and interrupted writes on startup', async () => {
  let location = await directory(), cache = createPreviewCache(location)
  await cache.restore([owner]); cache.set(owner.paneId, snapshot); await cache.flush()
  await fs.writeFile(path.join(location, 'previews', 'abandoned.json.tmp'), 'partial')
  let reopened = createPreviewCache(location)
  await reopened.restore([{ ...owner, windowId: 'window-two' }])
  expect(reopened.snapshots).toEqual({})
  expect(await fs.readdir(path.join(location, 'previews'))).toEqual([])
})

it('keeps private session previews in memory', async () => {
  let location = await directory(), cache = createPreviewCache(location)
  await cache.restore([{ ...owner, persistent: false }]); cache.set(owner.paneId, snapshot); await cache.flush()
  expect(cache.snapshots[owner.paneId]).toEqual(snapshot)
  expect(await fs.readdir(location)).toEqual([])
  cache.reconcile([]); await cache.flush()
  expect(cache.snapshots).toEqual({})
})
