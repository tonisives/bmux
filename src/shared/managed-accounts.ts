export const ACCOUNT_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'x', 'reddit', 'linkedin'] as const
export type AccountPlatform = typeof ACCOUNT_PLATFORMS[number]
export type AccountProject = { id: string; name: string; timezone: string }
export type AccountPersona = { id: string; project_id: string; name: string; interests: string }
export type ManagedAccount = { id: string; persona_id: string; platform: AccountPlatform; handle: string; status: 'draft' | 'paused' | 'ready' | 'archived' }
export type AccountSchedule = { id: string; account_id: string; kind: 'warmup' | 'post' | 'analytics'; job: string; scheduled_at: string; duration_minutes: number; status: 'blocked' | 'cancelled' }
export type AccountsSnapshot = { projects: AccountProject[]; personas: AccountPersona[]; accounts: ManagedAccount[]; schedules: AccountSchedule[]; executionEnabled: false }
