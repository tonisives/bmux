import type { LoginSession } from './types'
export let readSession = async (): Promise<LoginSession | undefined> => undefined
export let writeSession = async (_session: LoginSession) => {}
export let clearSession = async () => {}
export let readSecret = async (key: string) => localStorage.getItem(key)
export let writeSecret = async (key: string, value: string) => { localStorage.setItem(key, value) }
