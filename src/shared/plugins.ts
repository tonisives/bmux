export type PluginCapability = 'browser.forms' | 'browser.read' | 'browser.write' | 'browser.manage' | 'browser.cdp' | 'ui'
export type PluginParameter = { name: string; title: string; kind: 'text' | 'password' | 'boolean' | 'choice'; required?: boolean; choices?: string[] }
export type PluginAction = { id: string; title: string; description?: string; command: string[]; capabilities: PluginCapability[]; timeout_seconds: number; parameters: PluginParameter[] }
export type PluginHook = PluginAction & { event: 'startup' | 'page-ready' | 'url-change'; matches?: string[]; profiles?: string[] }
export type PluginProxyRegion = { group: string; label: string; protocol: 'http' | 'https' | 'socks5'; host: string; port: number }
export type PluginProxyProvider = { id: string; title: string; help?: string; authenticated: boolean; regions: PluginProxyRegion[] }
export type PluginManifest = { schema_version: 1; id: string; name: string; version: string; actions: PluginAction[]; hooks: PluginHook[]; proxyProviders: PluginProxyProvider[] }
export type PluginSettings = Record<string, { enabled: boolean; hooks: boolean }>
export type PluginInfo = { id: string; name: string; version: string; enabled: boolean; hooks: boolean; error?: string; actions: Pick<PluginAction, 'id' | 'title' | 'description'>[]; proxyProviders: PluginProxyProvider[] }
export type PluginContext = { clientId?: string; sessionId?: string; windowId?: string; paneId?: string; profileId?: string; documentId?: string; url?: string }
export type PluginRun = { id: string; pluginId: string; actionId: string; title: string; hook: boolean; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; progress?: { percent: number; message: string }; result?: unknown; error?: string }
export type PluginPrompt = { id: string; runId: string; pluginName: string; kind: 'pick' | 'text' | 'password' | 'confirm'; title: string; required?: boolean; items?: { id: string; label: string; description?: string }[] }
export let pluginBinding = (value: string) => /^plugin:[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)
