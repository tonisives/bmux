export type LoginField = { selector: string; role: 'username' | 'password'; expectedType: string; requireEmpty?: boolean; loginPassword?: boolean }
export type LoginForm = { kind: 'username' | 'password' | 'combined' | 'none' | 'ambiguous' | 'occupied'; fields: LoginField[]; focused?: string }

// This function runs in the page and returns field descriptions only.
export let inspectLoginForm = (): LoginForm => {
  let visible = (node: HTMLInputElement) => node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.disabled && !node.readOnly
  let inputs = Array.from(document.querySelectorAll('input')).filter(visible)
  let passwordInputs = inputs.filter(node => node.type === 'password')
  let empty = (kind: LoginForm['kind']): LoginForm => ({ kind, fields: [] })
  if (passwordInputs.some(node => node.autocomplete.split(/\s+/).includes('new-password')) || passwordInputs.length > 1) return empty('ambiguous')
  let password = passwordInputs[0]
  if (password?.value) return empty('occupied')
  let users = inputs.filter(node => ['text', 'email', 'tel'].includes(node.type) && (!password || (node.form === password.form && !!(node.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING))))
  let hints = (node: HTMLInputElement) => [node.name, node.id, node.getAttribute('aria-label'), ...Array.from(node.labels ?? [], label => label.textContent)].join(' ')
  users = users.filter(node => !/one.time|otp|verification|security.code|search|cc-|new-password/i.test(node.autocomplete + ' ' + hints(node)))
  let explicit = users.filter(node => node.autocomplete.split(/\s+/).includes('username'))
  let candidates = explicit.length ? explicit : users.filter(node => node.type === 'email' || /user|e.?mail|login|phone/i.test(hints(node)))
  // The traditional text field immediately before a password is also supported.
  if (!candidates.length && password && users.length === 1) candidates = users
  if (candidates.length > 1) return empty('ambiguous')
  let username = candidates[0]
  if (!password && !username) return empty('none')
  let selector = (node: Element) => {
    if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) return '#' + CSS.escape(node.id)
    let parts: string[] = []
    while (node !== document.documentElement) {
      let parent = node.parentElement!
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')')
      node = parent
    }
    return 'html > ' + parts.join(' > ')
  }
  let fields: LoginField[] = []
  if (username) fields.push({ selector: selector(username), role: 'username', expectedType: username.type })
  if (password) fields.push({ selector: selector(password), role: 'password', expectedType: 'password', requireEmpty: true, loginPassword: true })
  let active = document.activeElement
  return { kind: password ? username ? 'combined' : 'password' : 'username', fields, focused: active === username || active === password ? selector(active!) : undefined }
}
