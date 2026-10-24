import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AccountApi } from '../../src/shared/remote-account'
import { attentionIdFromData } from './links'
import * as Crypto from 'expo-crypto'

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })
let deviceKey = 'bmux.remote.push-device'
let handledResponses = new Set<string>()
export let pushDevice = async () => {
  let device = await AsyncStorage.getItem(deviceKey)
  if (!device) { device = Crypto.randomUUID(); await AsyncStorage.setItem(deviceKey, device) }
  return device
}
export let registerPush = async (api: AccountApi, requestPermission = false) => {
  await Notifications.setNotificationChannelAsync('attention', { name: 'Human help', importance: Notifications.AndroidImportance.HIGH })
  let permission = await Notifications.getPermissionsAsync()
  if (permission.status !== 'granted' && requestPermission) permission = await Notifications.requestPermissionsAsync()
  if (permission.status !== 'granted') return false
  let projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) throw new Error('Notifications are not configured for this build.')
  let { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  await api('/api/attention/devices', { device: await pushDevice(), token })
  return true
}
export let removePush = async (api: AccountApi) => { await api('/api/attention/devices/remove', { device: await pushDevice() }) }
export let observeNotifications = (open: (id: string) => void, refresh: () => void, api: AccountApi) => {
  let response = (value: Notifications.NotificationResponse | null) => {
    if (!value) return
    let request = value.notification.request
    if (handledResponses.has(request.identifier)) return
    let id = attentionIdFromData(request.content.data)
    if (!id) return
    handledResponses.add(request.identifier)
    void Notifications.clearLastNotificationResponseAsync()
    open(id)
  }
  let tapped = Notifications.addNotificationResponseReceivedListener(response)
  let received = Notifications.addNotificationReceivedListener(() => refresh())
  let rotated = Notifications.addPushTokenListener(() => { void registerPush(api).catch(() => {}) })
  void Notifications.getLastNotificationResponseAsync().then(response)
  return () => { tapped.remove(); received.remove(); rotated.remove() }
}
