import { expect, it, vi } from 'vitest'
import { notifyDisconnected } from '../remote/peer-disconnect'

let fixture = () => {
  let viewer = { id: 'viewer', owner: 'owner', role: 'viewer' as const }
  let host = { id: 'host', owner: 'owner', role: 'host' as const }
  let peers = new Map<string, typeof viewer | typeof host>([[host.id, host]])
  let authorize!: (access: boolean) => void
  let permission = vi.fn(() => new Promise<boolean>(resolve => { authorize = resolve }))
  let send = vi.fn()
  let notification = notifyDisconnected(peers, viewer, permission, send)
  return { viewer, host, peers, authorize, send, notification }
}

it('does not disconnect a replacement viewer while the old socket finishes authorization', async () => {
  let { viewer, peers, authorize, send, notification } = fixture()
  peers.set(viewer.id, { ...viewer })
  authorize(true)
  await notification
  expect(send).not.toHaveBeenCalled()
})

it('does not deliver an old disconnect to a replacement host connection', async () => {
  let { host, peers, authorize, send, notification } = fixture()
  peers.set(host.id, { ...host })
  authorize(true)
  await notification
  expect(send).not.toHaveBeenCalled()
})

it.each([true, false])('notifies remaining authorized connections when access is %s', async access => {
  let { viewer, host, authorize, send, notification } = fixture()
  authorize(access)
  await notification
  expect(send.mock.calls).toEqual(access ? [[host, { type: 'disconnected', id: viewer.id }]] : [])
})
