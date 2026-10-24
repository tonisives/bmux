import type { AccountApi } from '../../src/shared/remote-account'
export let registerPush = async (_api: AccountApi, _requestPermission = false) => false
export let removePush = async (_api: AccountApi) => {}
export let observeNotifications = (_open: (id: string) => void, _refresh: () => void, _api: AccountApi) => () => {}
