import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type VaultLogin = { id: string; type: number; name?: string; deletedDate?: string; reprompt?: number; login: { username?: string; password: string; uris?: { uri: string; match?: number }[] } }
export let sameOrigin = (item: VaultLogin, origin: string) => item?.type === 1 && !item.deletedDate && item.login?.uris?.some(entry => {
  try { return entry.match !== 5 && new URL(entry.uri).origin === origin } catch { return false }
})

export let createVault = (options: { executable?: string } = {}) => {
  let executable = options.executable ?? process.env.BMUX_BITWARDEN_CLI ?? (fs.existsSync('/opt/homebrew/bin/bw') ? '/opt/homebrew/bin/bw' : 'bw')
  let session = process.env.BW_SESSION ?? '', generation = 0
  delete process.env.BW_SESSION
  let directory = process.env.BITWARDENCLI_APPDATA_DIR ?? (options.executable || process.env.BMUX_BITWARDEN_CLI ? undefined
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Bitwarden CLI')
      : process.platform === 'win32' ? process.env.APPDATA && path.join(process.env.APPDATA, 'Bitwarden CLI')
        : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Bitwarden CLI'))
  type Status = { status: string; userId?: string; serverUrl?: string; revision?: string }
  type Cached<T> = { value: T; stamp: string; generation: number; expires: number }
  let statusCache: Cached<Status> | undefined, loginCache: (Cached<VaultLogin[]> & { origin: string }) | undefined
  let cacheExpiry: ReturnType<typeof setTimeout> | undefined
  let clearCache = () => { statusCache = undefined; loginCache = undefined; clearTimeout(cacheExpiry) }
  // Only metadata is inspected. Never parse the CLI's encrypted vault ourselves.
  let stamp = async () => {
    if (!directory) return undefined
    try {
      let stat = await fs.promises.stat(path.join(directory, 'data.json'), { bigint: true })
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
    } catch { return undefined }
  }
  let cached = async <T>(entry: Cached<T> | undefined, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    let current = await stamp()
    signal?.throwIfAborted()
    if (entry && session && entry.generation === generation && current === entry.stamp && Date.now() < entry.expires) return structuredClone(entry.value)
    if (!current || statusCache && statusCache.stamp !== current || loginCache && loginCache.stamp !== current) clearCache()
    return undefined
  }
  let children = new Set<ReturnType<typeof spawn>>()
  let command = (args: string[], signal?: AbortSignal, extra: NodeJS.ProcessEnv = {}, timeout = 30000) => new Promise<string>((resolve, reject) => {
    signal?.throwIfAborted()
    let env: NodeJS.ProcessEnv = { ...process.env, ...extra, BW_SESSION: session, BW_NOINTERACTION: 'true' }
    delete env.BMUX_PLUGIN_TOKEN; delete env.BMUX_PLUGIN_SOCKET; delete env.ELECTRON_RUN_AS_NODE
    // Shell output preferences must not turn a session key into a JSON response,
    // suppress output, or make a failed unlock look successful.
    for (let key of ['BW_RAW', 'BW_RESPONSE', 'BW_PRETTY', 'BW_QUIET', 'BW_CLEANEXIT']) delete env[key]
    let child = spawn(executable, [...args, '--nointeraction'], { env, stdio: ['ignore', 'pipe', 'ignore'] }), output = '', settled = false
    children.add(child)
    let finish = (failed: boolean) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); children.delete(child)
      if (failed) { clearCache(); reject(new Error('Bitwarden CLI request failed')) }
      else resolve(output.trim())
      output = ''
    }
    let abort = () => { child.kill('SIGKILL'); finish(true) }
    let timer = setTimeout(abort, timeout)
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', chunk => { output += chunk; if (output.length > 8_000_000) abort() })
    child.on('error', () => finish(true))
    child.on('close', code => finish(code !== 0 || signal?.aborted === true))
  })
  return {
    hasSession: () => !!session,
    status: async (signal?: AbortSignal, fresh = false): Promise<{ status: string; userId?: string; serverUrl?: string; revision?: string }> => {
      try {
        if (fresh) clearCache()
        let hit = await cached(statusCache, signal)
        if (hit) return hit
        let started = generation, before = await stamp()
        let value: Status = JSON.parse(await command(['status'], signal))
        let after = await stamp()
        signal?.throwIfAborted()
        if (started !== generation) throw new Error('Vault session changed')
        value.revision = before === after ? after : undefined
        if (value.status === 'unlocked' && session && before && before === after) statusCache = { value: { ...value }, stamp: after, generation, expires: Date.now() + 30000 }
        else clearCache()
        return value
      } catch { throw new Error('Could not check Bitwarden. Install bw and run bw login in a terminal.') }
    },
    unlock: async (password: string, signal?: AbortSignal) => {
      clearCache()
      let started = ++generation
      let key = await command(['unlock', '--passwordenv', 'BMUX_VAULT_PASSWORD', '--raw'], signal, { BMUX_VAULT_PASSWORD: password }, 120000)
      signal?.throwIfAborted()
      if (started !== generation) throw new Error('Unlock cancelled')
      if (!/^[A-Za-z0-9+/]{86}==$/.test(key) || Buffer.from(key, 'base64').length !== 64) throw new Error('Bitwarden returned an invalid session key')
      session = key
    },
    logins: async (origin: string, signal?: AbortSignal, fresh = false): Promise<VaultLogin[]> => {
      try {
        if (fresh) clearCache()
        let hit = await cached(loginCache?.origin === origin ? loginCache : undefined, signal)
        if (hit) return hit
        let started = generation, before = await stamp()
        let items = JSON.parse(await command(['list', 'items', '--url', origin], signal))
        let after = await stamp()
        signal?.throwIfAborted()
        if (started !== generation || !Array.isArray(items)) throw new Error()
        let value: VaultLogin[] = items.filter(item => sameOrigin(item, origin) && typeof item.login.password === 'string')
        if (session && before && before === after) {
          loginCache = { value: structuredClone(value), origin, stamp: after, generation, expires: Date.now() + 30000 }
          clearTimeout(cacheExpiry)
          cacheExpiry = setTimeout(() => { loginCache = undefined }, 30000)
          cacheExpiry.unref()
        }
        return value
      } catch { throw new Error('Bitwarden CLI request failed') }
    },
    close: () => { generation++; session = ''; clearCache(); for (let child of children) child.kill('SIGKILL') },
  }
}
