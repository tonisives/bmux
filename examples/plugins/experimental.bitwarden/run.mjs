import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createBitwardenConnection } from './protocol.mjs'

let host = (method, args = {}) => new Promise((resolve, reject) => {
  let child = spawn(process.env.BMUX_CLI, ['plugin', 'host', method, '--stdin'], { stdio: ['pipe', 'pipe', 'ignore'] }), output = ''
  child.stdin.on('error', () => undefined)
  child.stdout.on('data', chunk => { output += chunk })
  child.on('error', () => reject(new Error('Plugin host unavailable')))
  child.on('exit', code => { try { let response = JSON.parse(output); if (code || !response.ok) throw new Error(); resolve(response.result) } catch { reject(new Error('Plugin host request failed')) } })
  child.stdin.end(JSON.stringify(args))
})
let waitForClient = async () => {
  await host('progress', { percent: 50, message: 'Return to the original bmux tab to continue' })
  while (!(await host('context')).interactive) await new Promise(resolve => setTimeout(resolve, 200))
}
let main = async () => {
  let context = await host('context'), action = process.argv[2]
  if (action === 'fill' && !/^https?:\/\//.test(context.url ?? '')) throw new Error('Open a login page first')
  let approved = await host('ui', { kind: 'confirm', title: 'Experimental desktop pairing can replace DuckDuckGo’s pairing key. Continue?' })
  if (!approved) return
  let proxy = process.env.BMUX_BITWARDEN_PROXY ?? '/Applications/Bitwarden.app/Contents/MacOS/desktop_proxy'
  if (!fs.existsSync(proxy)) throw new Error('Bitwarden desktop proxy is not installed')
  await host('progress', { percent: 10, message: 'Approve bmux in Bitwarden, then return here' })
  let child = spawn(proxy, [], { stdio: ['pipe', 'pipe', 'pipe'] }), connection = createBitwardenConnection(child)
  try {
    await connection.connect()
    let accounts = await connection.command('bw-status')
    if (!Array.isArray(accounts)) throw new Error('Unsupported account response')
    let active = accounts.find(account => account.active)
    if (action === 'status') { await host('result', { connected: true, status: active?.status ?? 'no-account' }); await host('progress', { percent: 100, message: `Desktop connected: ${active?.status ?? 'no account'}` }); return }
    if (active?.status !== 'unlocked') throw new Error('Unlock the active Bitwarden account and retry')
    let credentials = await connection.command('bw-credential-retrieval', { uri: context.url })
    if (!Array.isArray(credentials) || !credentials.length) { await host('progress', { percent: 100, message: 'No matching logins' }); return }
    await waitForClient()
    if (new URL(context.url).protocol === 'http:' && !await host('ui', { kind: 'confirm', title: 'This page uses unencrypted HTTP. Fill credentials anyway?' })) return
    let selected = await host('ui', { kind: 'pick', title: 'Choose a login', items: credentials.map((item, index) => ({ id: String(index), label: item.name || 'Login', description: item.userName || '' })) })
    let credential = credentials[Number(selected)]
    if (!credential || typeof credential.password !== 'string') throw new Error('Login has no password')
    let selectors = await host('eval', { expression: `(() => {
      let visible = node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.disabled && !node.readOnly;
      let inputs = Array.from(document.querySelectorAll('input'));
      let passwords = inputs.filter(node => node.type === 'password' && node.autocomplete !== 'new-password' && visible(node));
      if (passwords.length !== 1) return null;
      let password = passwords[0], form = password.form;
      let users = inputs.filter(node => ['text', 'email'].includes(node.type) && visible(node) && node.form === form && (node.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
      let username = users.find(node => node.autocomplete === 'username') || users.at(-1);
      let selector = node => { let parts = []; while (node && node !== document.documentElement) { let parent = node.parentElement; if (!parent) return null; parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')'); node = parent; } return 'html > ' + parts.join(' > '); };
      return { password: selector(password), username: username ? selector(username) : null };
    })()` })
    if (!selectors?.password) throw new Error('Could not identify a single visible login form')
    let fields = [{ selector: selectors.password, value: credential.password }]
    if (selectors.username && credential.userName) fields.unshift({ selector: selectors.username, value: credential.userName })
    await host('fill', { origin: new URL(context.url).origin, fields })
    await host('result', { filled: true })
  } finally { connection.close() }
}
try { await main() } catch {
  await host('progress', { percent: 100, message: 'Bitwarden experiment could not complete. Check desktop integration, unlock status, and the original login page.' }).catch(() => undefined)
  process.exitCode = 1
}
