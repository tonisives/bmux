import { createHash } from 'node:crypto'
import { createPreviewCache } from './preview-cache'
import type { Snapshot } from '../shared/types'
import type { Host } from '../../remote/web/client'

let owner = (host: Host, session: Host['sessions'][number], paneId: string, save = true) => ({
  paneId: createHash('sha256').update(JSON.stringify([host.id, host.key?.x, session.id, paneId])).digest('hex'),
  windowId: host.key?.x ?? host.id, profileId: session.id, persistent: save && session.private === false,
})
export let createRemotePreviews = (directory: string, saveLocally = () => true) => {
  let cache = createPreviewCache(directory), hosts: Host[] = [], loaded = false
  let queue = Promise.resolve()
  let saving = saveLocally()
  let apply = async (next: Host[]) => {
    let changed = saving !== saveLocally(), saved = changed ? { ...cache.snapshots } : {}
    saving = saveLocally()
    let owners = next.flatMap(host => host.sessions.flatMap(session => session.panes.map(pane => owner(host, session, pane.id, saving))))
    if (!loaded) { await cache.restore(owners); loaded = true } else cache.reconcile(owners)
    for (let owner of owners) if (!cache.snapshots[owner.paneId] && saved[owner.paneId]) cache.set(owner.paneId, saved[owner.paneId])
    hosts = next
  }
  let reconcile = (next: Host[]) => { queue = queue.then(() => apply(next)); return queue }
  let configure = () => { queue = queue.then(() => loaded ? apply(hosts) : undefined); return queue }
  let session = (hostId: string, sessionId: string) => {
    let host = hosts.find(host => host.id === hostId), session = host?.sessions.find(session => session.id === sessionId)
    return host && session ? { host, session } : undefined
  }
  let set = async (host: Pick<Host, 'id' | 'key'>, sessionId: string, paneId: string, image: string, capturedAt = Date.now()) => {
    await queue
    let selected = session(host.id, sessionId)
    if (!selected?.session.panes.some(pane => pane.id === paneId) || selected.host.key?.x !== host.key?.x) return
    if (typeof image !== 'string' || image.length > 4 * 1024 * 1024 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error('Invalid remote preview')
    if (!Number.isFinite(capturedAt) || capturedAt <= 0) throw new Error('Invalid remote preview timestamp')
    let id = owner(selected.host, selected.session, paneId).paneId
    if ((cache.snapshots[id]?.capturedAt ?? 0) <= capturedAt) cache.set(id, { image, capturedAt })
  }
  let get = async (hostId: string, sessionId: string): Promise<Record<string, Snapshot>> => {
    await queue
    let selected = session(hostId, sessionId)
    return selected ? Object.fromEntries(selected.session.panes.flatMap(pane => {
      let snapshot = cache.snapshots[owner(selected.host, selected.session, pane.id).paneId]
      return snapshot ? [[pane.id, snapshot]] : []
    })) : {}
  }
  return { reconcile, configure, set, get, flush: async () => { await queue; await cache.flush() } }
}
