import { createViewer } from '../../remote/web/client'
import { loadIdentity } from './identity'
import { origin } from './api'
import type { AccountApi } from '../../src/shared/remote-account'
import type { ViewerEvents } from '../../remote/web/client'

export let openViewer = async (owner: string, api: AccountApi, events: ViewerEvents) => createViewer(events, {
  origin,
  identity: await loadIdentity(owner),
  connect: publicKey => api('/api/connect', { publicKey }),
})
