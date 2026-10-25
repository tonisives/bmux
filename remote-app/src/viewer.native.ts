import { AppState } from 'react-native'
import { RTCPeerConnection } from 'react-native-webrtc'
import * as Crypto from 'expo-crypto'
import { createViewer } from '../../remote/web/client'
import type { ViewerEvents } from '../../remote/web/client'
import type { AccountApi } from '../../src/shared/remote-account'
import { origin } from './api'
import { loadIdentity } from './identity'

export let openViewer = async (owner: string, api: AccountApi, events: ViewerEvents) => createViewer(events, {
  origin,
  identity: await loadIdentity(owner),
  connect: publicKey => api('/api/connect', { publicKey }),
  uuid: () => Crypto.randomUUID(),
  socket: url => new WebSocket(url.toString()) as unknown as WebSocket,
  peer: configuration => new RTCPeerConnection({ iceServers: configuration.iceServers }) as unknown as globalThis.RTCPeerConnection,
  observe: refresh => {
    let listener = AppState.addEventListener('change', state => { if (state === 'active') refresh() })
    return () => listener.remove()
  },
})
