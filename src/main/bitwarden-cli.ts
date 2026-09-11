import { spawn } from 'node:child_process'
import fs from 'node:fs'

export type VaultLogin = { id: string; type: number; name?: string; deletedDate?: string; reprompt?: number; login: { username?: string; password: string; uris?: { uri: string; match?: number }[] } }
export let sameOrigin = (item: VaultLogin, origin: string) => item?.type === 1 && !item.deletedDate && item.login?.uris?.some(entry => {
  try { return entry.match !== 5 && new URL(entry.uri).origin === origin } catch { return false }
})

export let createVault = (options: { executable?: string } = {}) => {
  let executable = options.executable ?? process.env.BMUX_BITWARDEN_CLI ?? (fs.existsSync('/opt/homebrew/bin/bw') ? '/opt/homebrew/bin/bw' : 'bw')
  let session = process.env.BW_SESSION ?? '', generation = 0
  delete process.env.BW_SESSION
  let children = new Set<ReturnType<typeof spawn>>()
  let command = (args: string[], signal?: AbortSignal, extra: NodeJS.ProcessEnv = {}) => new Promise<string>((resolve, reject) => {
    signal?.throwIfAborted()
    let env: NodeJS.ProcessEnv = { ...process.env, ...extra, BW_SESSION: session, BW_NOINTERACTION: 'true' }
    delete env.BMUX_PLUGIN_TOKEN; delete env.BMUX_PLUGIN_SOCKET; delete env.ELECTRON_RUN_AS_NODE
    let child = spawn(executable, [...args, '--nointeraction'], { env, stdio: ['ignore', 'pipe', 'ignore'] }), output = '', settled = false
    children.add(child)
    let finish = (failed: boolean) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); children.delete(child)
      if (failed) reject(new Error('Bitwarden CLI request failed'))
      else resolve(output.trim())
      output = ''
    }
    let abort = () => { child.kill('SIGKILL'); finish(true) }
    let timer = setTimeout(abort, 30000)
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', chunk => { output += chunk; if (output.length > 8_000_000) abort() })
    child.on('error', () => finish(true))
    child.on('close', code => finish(code !== 0 || signal?.aborted === true))
  })
  return {
    status: async (signal?: AbortSignal): Promise<{ status: string; userId?: string; serverUrl?: string }> => {
      try { return JSON.parse(await command(['status'], signal)) } catch { throw new Error('Could not check Bitwarden. Install bw and run bw login in a terminal.') }
    },
    unlock: async (password: string, signal?: AbortSignal) => {
      let started = generation
      let key = await command(['unlock', '--passwordenv', 'BMUX_VAULT_PASSWORD', '--raw'], signal, { BMUX_VAULT_PASSWORD: password })
      signal?.throwIfAborted()
      if (!key || started !== generation) throw new Error('Unlock cancelled')
      session = key
    },
    logins: async (origin: string, signal?: AbortSignal): Promise<VaultLogin[]> => {
      try {
        let items = JSON.parse(await command(['list', 'items', '--url', origin], signal))
        if (!Array.isArray(items)) throw new Error()
        return items.filter(item => sameOrigin(item, origin) && typeof item.login.password === 'string')
      } catch { throw new Error('Bitwarden CLI request failed') }
    },
    close: () => { generation++; session = ''; for (let child of children) child.kill('SIGKILL') },
  }
}
