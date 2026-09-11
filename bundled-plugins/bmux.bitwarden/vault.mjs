import { spawn } from 'node:child_process'
import fs from 'node:fs'

export let sameOrigin = (item, origin) => item?.type === 1 && !item.deletedDate && item.login?.uris?.some(entry => {
  try { return entry.match !== 5 && new URL(entry.uri).origin === origin } catch { return false }
})
export let createVault = (options = {}) => {
  let executable = options.executable ?? process.env.BMUX_BITWARDEN_CLI ?? (fs.existsSync('/opt/homebrew/bin/bw') ? '/opt/homebrew/bin/bw' : 'bw')
  let session = process.env.BW_SESSION ?? ''
  let command = (args, extra = {}) => new Promise((resolve, reject) => {
    let env = { ...process.env, ...extra, BW_SESSION: session, BW_NOINTERACTION: 'true' }
    delete env.BMUX_PLUGIN_TOKEN; delete env.BMUX_PLUGIN_SOCKET; delete env.ELECTRON_RUN_AS_NODE
    let child = spawn(executable, [...args, '--nointeraction'], { env, stdio: ['ignore', 'pipe', 'ignore'] }), output = '', settled = false
    let finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(new Error('Bitwarden CLI request failed')) : resolve(value) }
    let timer = setTimeout(() => { child.kill(); finish(true) }, 30000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 8_000_000) { child.kill(); finish(true) } })
    child.on('error', () => finish(true))
    child.on('exit', code => finish(code !== 0, output.trim()))
  })
  return {
    status: async () => JSON.parse(await command(['status'])),
    unlock: async password => { session = await command(['unlock', '--passwordenv', 'BMUX_VAULT_PASSWORD', '--raw'], { BMUX_VAULT_PASSWORD: password }); if (!session) throw new Error('Unlock failed') },
    logins: async origin => {
      let items = JSON.parse(await command(['list', 'items', '--url', origin]))
      if (!Array.isArray(items)) throw new Error('Invalid login list')
      return items.filter(item => sameOrigin(item, origin) && typeof item.login.password === 'string')
    },
    close: () => { session = '' },
  }
}
