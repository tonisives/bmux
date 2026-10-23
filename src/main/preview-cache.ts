import fs from 'node:fs/promises'
import path from 'node:path'
import type { Snapshot } from '../shared/types'

export type PreviewOwner = { paneId: string; windowId: string; profileId: string; persistent: boolean }
type StoredPreview = Snapshot & Pick<PreviewOwner, 'windowId' | 'profileId'>

export let createPreviewCache = (directory: string) => {
  let root = path.join(directory, 'previews')
  let snapshots: Record<string, Snapshot> = {}
  let owners = new Map<string, PreviewOwner>()
  let queue = Promise.resolve()
  let file = (paneId: string) => path.join(root, `${encodeURIComponent(paneId)}.json`)
  let enqueue = (operation: () => Promise<unknown>) => { queue = queue.then(operation).then(() => undefined).catch(() => undefined) }
  let set = (paneId: string, snapshot: Snapshot) => {
    let owner = owners.get(paneId)
    if (!owner) return
    snapshots[paneId] = snapshot
    if (!owner.persistent) return
    let stored: StoredPreview = { ...snapshot, windowId: owner.windowId, profileId: owner.profileId }
    enqueue(async () => {
      await fs.mkdir(root, { recursive: true, mode: 0o700 })
      await fs.writeFile(`${file(paneId)}.tmp`, JSON.stringify(stored), { mode: 0o600 })
      await fs.rename(`${file(paneId)}.tmp`, file(paneId))
    })
  }
  let remove = (paneId: string) => {
    delete snapshots[paneId]
    enqueue(() => fs.rm(file(paneId), { force: true }))
  }
  let reconcile = (next: PreviewOwner[]) => {
    let updated = new Map(next.map(owner => [owner.paneId, owner]))
    for (let [paneId, owner] of owners) {
      let replacement = updated.get(paneId)
      if (!replacement || replacement.windowId !== owner.windowId || replacement.profileId !== owner.profileId || replacement.persistent !== owner.persistent) remove(paneId)
    }
    owners = updated
  }
  let restore = async (next: PreviewOwner[]) => {
    reconcile(next)
    let names = await fs.readdir(root).catch(() => [])
    for (let name of names) {
      let location = path.join(root, name)
      let owner = next.find(owner => path.basename(file(owner.paneId)) === name && owner.persistent)
      try {
        if (!owner || (await fs.stat(location)).size > 4 * 1024 * 1024) throw new Error('Unused preview')
        let stored: StoredPreview = JSON.parse(await fs.readFile(location, 'utf8'))
        if (stored.windowId !== owner.windowId || stored.profileId !== owner.profileId || !Number.isFinite(stored.capturedAt) || typeof stored.image !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(stored.image)) throw new Error('Invalid preview')
        snapshots[owner.paneId] = { image: stored.image, capturedAt: stored.capturedAt }
      } catch { await fs.rm(location, { force: true }).catch(() => undefined) }
    }
  }
  return { snapshots, set, remove, reconcile, restore, flush: () => queue }
}
