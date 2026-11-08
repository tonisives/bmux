import type { ScrollingSettings } from './scrolling'
import type { AgentInfo } from './agent-info'
export type PluginCapability = 'browser.forms' | 'browser.read' | 'browser.write' | 'browser.manage' | 'browser.cdp' | 'ui' | 'ai.decisions'
export type PluginParameter = { name: string; title: string; kind: 'text' | 'password' | 'boolean' | 'choice'; required?: boolean; choices?: string[]; hidden?: boolean; default?: string | boolean; section?: string; description?: string; advanced?: boolean; multiline?: boolean; range?: { min: number; max: number; step: number; unit?: string } }
export type PluginPreset = { id: string; title: string; description?: string; values: Record<string, string | boolean> }
export type PluginSettingsProfiles = { active: string; items: { id: string; name: string }[]; templates?: { id: string; name: string }[] }
export type PluginProfileOperation = { action: 'create' | 'select' | 'rename' | 'delete'; id?: string; name?: string; template?: string }
export type PluginAction = { pacing?: 'plugin'; id: string; title: string; description?: string; group?: string; command: string[]; capabilities: PluginCapability[]; timeout_seconds: number; parameters: PluginParameter[]; launch_url?: string; launch_label?: string; configuration_command?: string[]; configuration_save_command?: string[]; configuration_profile_command?: string[]; presets?: PluginPreset[] }
export type PluginHook = PluginAction & { event: 'startup' | 'page-ready' | 'url-change'; matches?: string[]; profiles?: string[] }
export type PluginProxyRegion = { group: string; label: string; protocol: 'http' | 'https' | 'socks5'; host: string; port: number }
export type PluginProxyProvider = { id: string; title: string; help?: string; authenticated: boolean; regions: PluginProxyRegion[] }
export type PluginManifest = { schema_version: 1; id: string; name: string; category?: string; description?: string; version: string; actions: PluginAction[]; hooks: PluginHook[]; proxyProviders: PluginProxyProvider[]; bookmark?: BookmarkPluginContribution }
export type PluginSettings = Record<string, { enabled: boolean; hooks: boolean }>
export let sharedSocialField = (field: PluginParameter) => !field.hidden && field.kind !== 'password' && (field.section === 'Persona' || field.name === 'ai_source' || ['use_decisions', 'ai', 'ai_daily_limit', 'train_mode', 'train'].includes(field.name))
export type PluginInfo = { sent?: number; settingsAction?: string; bundled?: boolean; id: string; name: string; category?: string; description?: string; version: string; enabled: boolean; hooks: boolean; hasHooks?: boolean; error?: string; actions: Pick<PluginAction, 'id' | 'title' | 'description' | 'group'>[]; proxyProviders: PluginProxyProvider[]; bookmark?: BookmarkPluginContribution }
export type PluginContext = AgentInfo & { scrolling?: ScrollingSettings; pacing?: 'plugin'; runId?: string; clientId?: string; sessionId?: string; windowId?: string; paneId?: string; profileId?: string; agentId?: string; documentId?: string; url?: string; launchUrl?: string; launchApproved?: boolean }
export type PluginRun = { overlayPaneId?: string; id: string; pluginId: string; actionId: string; title: string; hook: boolean; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress?: { percent: number; message: string }; result?: unknown; error?: string }
export type PluginPrompt = { sharedSettings?: boolean; id: string; runId: string; pluginName: string; kind: 'pick' | 'text' | 'password' | 'confirm' | 'form'; fields?: PluginParameter[]; values?: Record<string, unknown>; savedValues?: Record<string, string | boolean>; autosave?: boolean; profiles?: PluginSettingsProfiles; presets?: PluginPreset[]; profileId?: string; launch?: boolean; launchLabel?: string; title: string; required?: boolean; items?: { id: string; label: string; description?: string }[] }
export let pluginBinding = (value: string) => /^plugin:[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)

export type BookmarkPluginValue = string | number | boolean
export type BookmarkPluginControl = { name: string; title: string; kind: 'number' | 'boolean' | 'text' | 'choice'; default: BookmarkPluginValue; min?: number; max?: number; step?: number; choices?: string[] }
export type BookmarkPluginContribution = { matches: string[]; script: string; controls: BookmarkPluginControl[] }
export type BookmarkPluginAttachment = { id: string; enabled: boolean; values: Record<string, BookmarkPluginValue> }
export type BookmarkHiddenPost = { key: string; title: string; url: string; reasons: string[] }
export type BookmarkPluginSettings = Record<string, Record<string, BookmarkPluginAttachment[]>>
