import { host, finish } from '../host.mjs'
import { createVault } from './vault.mjs'

await finish(async () => {
  let context = await host('context')
  if (!/^https?:\/\//.test(context.url ?? '')) { await host('progress', { percent: 100, message: 'Open a login page first' }); return }
  let origin = new URL(context.url).origin, vault = createVault()
  let unlock = async () => vault.unlock(await host('ui', { kind: 'password', title: 'Unlock Bitwarden', required: true }))
  try {
    await host('progress', { percent: 10, message: 'Checking Bitwarden CLI. Install bw and run bw login once if needed.' })
    let status = await vault.status()
    if (status.status === 'unauthenticated') { await host('progress', { percent: 100, message: 'Run bw login in a terminal, then try again' }); return }
    if (status.status !== 'unlocked') await unlock()
    let logins = await vault.logins(origin)
    if (!logins.length) { await host('progress', { percent: 100, message: 'No logins with an exact matching origin' }); return }
    let id = await host('ui', { kind: 'pick', title: `Login for ${origin}`, items: logins.map(item => ({ id: item.id, label: item.name || 'Login', description: item.login.username || '' })) })
    let login = logins.find(item => item.id === id)
    if (!login) return
    if (login.reprompt === 1) await unlock()
    if (new URL(origin).protocol === 'http:' && !await host('ui', { kind: 'confirm', title: 'Fill this login over unencrypted HTTP?' })) return
    let fields = await host('eval', { expression: `(() => {
      let visible = node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.disabled && !node.readOnly;
      let inputs = Array.from(document.querySelectorAll('input'));
      let passwords = inputs.filter(node => node.type === 'password' && node.autocomplete !== 'new-password' && visible(node));
      if (passwords.length !== 1) return null;
      let password = passwords[0], users = inputs.filter(node => ['text', 'email'].includes(node.type) && visible(node) && node.form === password.form && (node.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
      let username = users.find(node => node.autocomplete === 'username') || users.at(-1);
      let selector = node => { let parts = []; while (node && node !== document.documentElement) { let parent = node.parentElement; if (!parent) return null; parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')'); node = parent; } return 'html > ' + parts.join(' > '); };
      return [{ selector: selector(password), role: 'password', expectedType: password.type }, ...(username ? [{ selector: selector(username), role: 'username', expectedType: username.type }] : [])];
    })()` })
    if (!fields) { await host('progress', { percent: 100, message: 'Could not identify one visible login form in the main page' }); return }
    await host('fill', { origin, fields: fields.map(field => ({ selector: field.selector, expectedType: field.expectedType, value: field.role === 'password' ? login.login.password : login.login.username || '' })) })
    await host('result', { filled: true })
  } finally { vault.close() }
})
