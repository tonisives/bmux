export type SocialHookConfig = { enabled: boolean; url: string; format: 'posts' | 'tweettrace'; auth: 'none' | 'bearer' | 'api-key'; header: string; secret?: string; hasSecret?: boolean }
export type SocialHookReceipt = { profile: string; plugin: string; sent: number; inserted?: number; skipped?: number; at: number; error?: string }
export type SocialHookState = { config: SocialHookConfig; override: boolean; sent: number; pending: number; failed: number; recent: SocialHookReceipt[] }
export let emptySocialHook = (): SocialHookConfig => ({ enabled: false, url: '', format: 'posts', auth: 'none', header: 'x-api-key' })
