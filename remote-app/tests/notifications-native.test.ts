import { beforeEach, expect, it, vi } from 'vitest'
import type { NotificationResponse } from 'expo-notifications'

let mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(), callbacks: new Map<string, (value: unknown) => void>(), removes: [] as (() => void)[],
  permission: 'denied', project: 'remote-project' as string | undefined, token: 'ExpoPushToken[fixture]', last: null as NotificationResponse | null,
  requestPermission: vi.fn(), getToken: vi.fn(), clearLast: vi.fn(), uuid: vi.fn(),
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: async (key: string) => mocks.storage.get(key) ?? null, setItem: async (key: string, value: string) => { mocks.storage.set(key, value) } } }))
vi.mock('expo-crypto', () => ({ randomUUID: () => mocks.uuid() }))
vi.mock('expo-constants', () => ({ default: { easConfig: { get projectId() { return mocks.project } } } }))
vi.mock('expo-notifications', () => {
  let observe = (name: string, callback: (value: unknown) => void) => {
    mocks.callbacks.set(name, callback)
    let remove = vi.fn(() => { mocks.callbacks.delete(name) })
    mocks.removes.push(remove)
    return { remove }
  }
  return {
    setNotificationHandler: vi.fn(), AndroidImportance: { HIGH: 4 }, setNotificationChannelAsync: vi.fn(async () => {}),
    getPermissionsAsync: async () => ({ status: mocks.permission }), requestPermissionsAsync: mocks.requestPermission,
    getExpoPushTokenAsync: mocks.getToken, clearLastNotificationResponseAsync: mocks.clearLast,
    getLastNotificationResponseAsync: async () => mocks.last,
    addNotificationResponseReceivedListener: (callback: (value: unknown) => void) => observe('response', callback),
    addNotificationReceivedListener: (callback: (value: unknown) => void) => observe('received', callback),
    addPushTokenListener: (callback: (value: unknown) => void) => observe('token', callback),
  }
})
let response = (id: string, data: unknown) => ({ notification: { request: { identifier: id, content: { data } } } }) as NotificationResponse
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.storage.clear(); mocks.callbacks.clear(); mocks.removes = []
  mocks.permission = 'denied'; mocks.project = 'remote-project'; mocks.token = 'ExpoPushToken[fixture]'; mocks.last = null
  mocks.uuid.mockReturnValue('00000000-0000-4000-8000-000000000001')
  mocks.requestPermission.mockImplementation(async () => ({ status: 'granted' }))
  mocks.getToken.mockImplementation(async () => ({ data: mocks.token }))
  mocks.clearLast.mockResolvedValue(undefined)
})
it('does not prompt or bind a device without permission until the user opts in', async () => {
  let notifications = await import('../src/notifications.native'), api = vi.fn().mockResolvedValue({})
  expect(await notifications.registerPush(api)).toBe(false)
  expect(mocks.requestPermission).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
  expect(await notifications.registerPush(api, true)).toBe(true)
  expect(mocks.requestPermission).toHaveBeenCalledOnce()
  expect(mocks.getToken).toHaveBeenCalledWith({ projectId: 'remote-project' })
  expect(api).toHaveBeenCalledWith('/api/attention/devices', { device: '00000000-0000-4000-8000-000000000001', token: 'ExpoPushToken[fixture]' })
})
it('shares one persistent device identity during registration, rotation, and removal', async () => {
  mocks.permission = 'granted'
  let notifications = await import('../src/notifications.native'), api = vi.fn().mockResolvedValue({})
  await Promise.all([notifications.registerPush(api), notifications.registerPush(api)])
  expect(mocks.uuid).toHaveBeenCalledOnce()
  let stop = notifications.observeNotifications(vi.fn(), vi.fn(), api)
  mocks.token = 'ExpoPushToken[rotated]'
  mocks.callbacks.get('token')!({ data: 'native-provider-token' })
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/api/attention/devices', { device: '00000000-0000-4000-8000-000000000001', token: 'ExpoPushToken[rotated]' }))
  await notifications.removePush(api)
  expect(api).toHaveBeenLastCalledWith('/api/attention/devices/remove', { device: '00000000-0000-4000-8000-000000000001' })
  stop()
})
it('opens a cold or warm tap once using only the opaque attention ID', async () => {
  mocks.last = response('notification', { attentionId: 'opaque-id', host: 'untrusted', pane: 'untrusted' })
  let notifications = await import('../src/notifications.native'), open = vi.fn(), refresh = vi.fn(), api = vi.fn().mockResolvedValue({})
  let stop = notifications.observeNotifications(open, refresh, api)
  await vi.waitFor(() => expect(open).toHaveBeenCalledWith('opaque-id'))
  mocks.callbacks.get('response')!(mocks.last)
  expect(open).toHaveBeenCalledOnce()
  mocks.callbacks.get('response')!(response('invalid', { pane: 'untrusted' }))
  expect(open).toHaveBeenCalledOnce()
  mocks.callbacks.get('received')!({})
  expect(refresh).toHaveBeenCalledOnce()
  expect(api).not.toHaveBeenCalled()
  expect(mocks.clearLast).toHaveBeenCalledOnce()
  stop()
  expect(mocks.callbacks.size).toBe(0)
  for (let remove of mocks.removes) expect(remove).toHaveBeenCalledOnce()
})
it('requires this app’s Expo project before requesting a push token', async () => {
  mocks.permission = 'granted'; mocks.project = undefined
  let notifications = await import('../src/notifications.native'), api = vi.fn().mockResolvedValue({})
  await expect(notifications.registerPush(api)).rejects.toThrow('not configured')
  expect(mocks.getToken).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})
