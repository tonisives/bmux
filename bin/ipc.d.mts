import type { Server } from 'node:net'

export let controlSocketPath: (dataDirectory: string, platform?: string, home?: string, uid?: number) => string
export let createPluginSocket: () => { socketPath: string; directory?: string }
export let prepareControlSocket: (socketPath: string) => void
export let removeSocket: (socketPath: string) => void
export let listenSocket: (server: Server, socketPath: string) => Promise<void>
