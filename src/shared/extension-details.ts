export type ExtensionDetails = {
  description: string
  manifestVersion?: number
  permissions: string[]
  hostPermissions: string[]
  optionalPermissions: string[]
  optionalHostPermissions: string[]
  contentScriptMatches: string[]
  manifestAvailable: boolean
}

export let extensionDetails = (value: unknown): ExtensionDetails => {
  let manifest = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  let strings = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string'))] : []
  let isHost = (value: string) => value === '<all_urls>' || value.includes('://')
  let permissions = strings(manifest?.permissions), optional = strings(manifest?.optional_permissions)
  return {
    description: typeof manifest?.description === 'string' ? manifest.description : '',
    manifestVersion: typeof manifest?.manifest_version === 'number' ? manifest.manifest_version : undefined,
    permissions: permissions.filter(value => !isHost(value)),
    hostPermissions: strings([...permissions.filter(isHost), ...strings(manifest?.host_permissions)]),
    optionalPermissions: optional.filter(value => !isHost(value)),
    optionalHostPermissions: strings([...optional.filter(isHost), ...strings(manifest?.optional_host_permissions)]),
    contentScriptMatches: strings(Array.isArray(manifest?.content_scripts) ? manifest.content_scripts.flatMap(script => strings(script?.matches)) : []),
    manifestAvailable: !!manifest
  }
}
