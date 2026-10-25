import type { Host } from './types'

export let canManageHost = (host: Host | undefined): host is Host => !!host && host.owner !== false && host.permission === 'control'
