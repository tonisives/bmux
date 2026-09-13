import { randomUUID } from 'node:crypto'
import { createVault } from './bitwarden-cli'
import type { VaultLogin } from './bitwarden-cli'
import { inspectLoginForm } from './bitwarden-fields'
import type { LoginForm } from './bitwarden-fields'
import type { PluginContext } from '../shared/plugins'
import type { PasswordSuggestions } from '../shared/types'

export type VaultInteraction = {
  ui: (args: Record<string, unknown>) => Promise<unknown>
  progress: (message: string) => void
}
type Options = {
  vault?: ReturnType<typeof createVault>
  context: (context: PluginContext) => PluginContext
  interactive: (context: PluginContext) => boolean
  selected?: (context: PluginContext) => boolean
  browser: (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => Promise<unknown>
  changed: () => void
}
type Attempt = { context: PluginContext; controller: AbortController; login?: VaultLogin; expires?: number; timer?: ReturnType<typeof setTimeout>; navigating?: boolean }

export let createBitwarden = (options: Options) => {
  let vault = options.vault ?? createVault(), attempts = new Map<string, Attempt>()
  let notices = new Map<string, { tabId?: string; message: string; timer: ReturnType<typeof setTimeout> }>()
  let queue: Promise<unknown> = Promise.resolve(), account = '', locked = false
  let suggestion: { context: PluginContext; field: string; fresh?: number; value: PasswordSuggestions } | undefined
  let suggestionCheck: AbortController | undefined, suggestionKey = '', suggestionExpiry = 0, dismissedKey = ''
  let freshSelection: { id: string; tabId?: string; documentId?: string; expires: number } | undefined
  let origin = (context: PluginContext) => { try { return new URL(context.url!).origin } catch { return '' } }
  let clearSuggestions = () => {
    suggestionCheck?.abort(); suggestionCheck = undefined; suggestionKey = ''; suggestionExpiry = 0
    if (suggestion) { suggestion = undefined; options.changed() }
  }
  let notice = (context: PluginContext, message: string) => {
    if (!context.clientId) return
    clearTimeout(notices.get(context.clientId)?.timer)
    let timer = setTimeout(() => { notices.delete(context.clientId!); options.changed() }, 6000)
    timer.unref()
    notices.set(context.clientId, { tabId: context.tabId, message, timer }); options.changed()
  }
  let cancel = (tabId: string) => {
    let attempt = attempts.get(tabId)
    if (!attempt) return
    attempts.delete(tabId); clearTimeout(attempt.timer); attempt.controller.abort(); attempt.login = undefined
  }
  let cancelAttempt = (attempt: Attempt) => { if (attempts.get(attempt.context.tabId!) === attempt) cancel(attempt.context.tabId!) }
  let lock = () => {
    clearSuggestions()
    for (let attempt of attempts.values()) notice(attempt.context, 'Bitwarden locked in bmux')
    for (let tabId of attempts.keys()) cancel(tabId)
    vault.close(); account = ''; freshSelection = undefined
  }
  let current = (attempt: Attempt) => {
    attempt.controller.signal.throwIfAborted()
    let next = options.context(attempt.context)
    if (next.tabId !== attempt.context.tabId || next.profileId !== attempt.context.profileId || origin(next) !== origin(attempt.context)) throw new Error('Login page changed')
    return next
  }
  let inspect = async (context: PluginContext, signal: AbortSignal) => await options.browser('eval', { expression: `(${inspectLoginForm.toString()})()` }, context, signal) as LoginForm
  let validSuggestion = async (context: PluginContext, suggestionId: string, requireFocus = true) => {
    let available = requireFocus ? options.interactive : options.selected ?? options.interactive
    let entry = suggestion
    if (!entry || entry.value.id !== suggestionId || entry.context.clientId !== context.clientId || entry.context.tabId !== context.tabId || entry.context.documentId !== context.documentId || entry.context.profileId !== context.profileId || entry.context.url !== context.url || !available(context)) throw new Error('Password suggestion expired')
    let form = await inspect(context, new AbortController().signal)
    let next = options.context(context)
    if (suggestion !== entry || (form.focused ? form.focused !== entry.field : !form.fields.some(field => field.selector === entry.field)) || next.documentId !== context.documentId || next.url !== context.url || next.profileId !== context.profileId || !available(context)) throw new Error('Login field changed')
    return entry
  }
  let forgetSession = () => {
    for (let tabId of attempts.keys()) cancel(tabId)
    vault.close(); account = ''; freshSelection = undefined
  }
  let loadSuggestions = async (context: PluginContext, suggestionId: string, password?: string) => {
    let unlocking = password !== undefined
    let entry = await validSuggestion(context, suggestionId)
    if (entry.value.busy || locked) return
    suggestionCheck?.abort()
    let controller = new AbortController(), signal = controller.signal
    suggestionCheck = controller
    let valid = async () => { signal.throwIfAborted(); await validSuggestion(context, suggestionId, false); signal.throwIfAborted() }
    entry.value = { ...entry.value, busy: true, message: undefined }; options.changed()
    let previous = queue
    let next = previous.catch(() => undefined).then(async () => {
      await valid()
      let status = await vault.status(signal)
      await valid()
      if (status.status === 'unauthenticated') { forgetSession(); throw new Error('Run bw login in a terminal, then try again.') }
      let identity = JSON.stringify([status.userId, status.serverUrl])
      if (account && account !== identity) { forgetSession(); status.status = 'locked' }
      if (status.status !== 'unlocked') {
        if (password === undefined) { forgetSession(); throw new Error('Your Bitwarden session expired. Unlock again.') }
        try { await vault.unlock(password, signal) }
        catch { throw new Error('Could not unlock Bitwarden. Check your master password and try again.') }
        finally { password = undefined }
        // Verify the key in a new CLI process before presenting the vault as unlocked.
        status = await vault.status(signal)
        if (status.status !== 'unlocked') { forgetSession(); throw new Error('Bitwarden did not retain the unlock. Try again.') }
        entry.fresh = Date.now() + 120000
      }
      account = JSON.stringify([status.userId, status.serverUrl])
      await valid()
      entry.value = { ...entry.value, locked: false }; options.changed()
      try {
        let logins = await vault.logins(origin(context), signal)
        return logins.map(item => ({ id: item.id, name: item.name || 'Login', username: item.login.username || '' }))
      } catch { throw new Error('Could not load logins. Your vault is still unlocked. Try again.') }
    })
    queue = next.then(() => undefined, () => undefined)
    try {
      let items = await next
      await valid()
      entry.value = { ...entry.value, locked: false, busy: false, items }
      suggestionExpiry = Date.now() + 30000
      options.changed()
    } catch (error) {
      if (!signal.aborted && suggestion === entry) {
        entry.value = { ...entry.value, locked: !vault.hasSession(), expanded: unlocking && entry.value.expanded, busy: false, items: [], message: error instanceof Error ? error.message : 'Could not load Bitwarden. Try again.' }
        suggestionExpiry = Date.now() + 30000
        options.changed()
      }
    } finally { password = undefined; if (suggestionCheck === controller) suggestionCheck = undefined }
  }
  let suggest = async (context?: PluginContext) => {
    if (!context?.tabId || locked || attempts.has(context.tabId) || !/^https?:\/\//.test(context.url ?? '')) { clearSuggestions(); return }
    if (!options.interactive(context)) return
    if (suggestionCheck) return
    let controller = new AbortController(), signal = controller.signal
    suggestionCheck = controller
    try {
      let form = await inspect(context, signal)
      signal.throwIfAborted()
      let next = options.context(context)
      if (next.documentId !== context.documentId || next.url !== context.url || next.profileId !== context.profileId) { clearSuggestions(); return }
      // A pending inspection can finish after the app has lost focus.
      if (!options.interactive(context)) return
      if (!form.focused || !form.anchor || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(form.anchor![key as keyof typeof form.anchor])) || form.anchor.width <= 0 || form.anchor.height <= 0) { dismissedKey = ''; clearSuggestions(); return }
      let key = JSON.stringify([context.clientId, context.tabId, context.profileId, context.documentId, context.url, form.focused])
      if (key === dismissedKey) return
      dismissedKey = ''
      if (suggestion && key === suggestionKey) {
        if (JSON.stringify(suggestion.value.anchor) !== JSON.stringify(form.anchor)) { suggestion.value = { ...suggestion.value, anchor: form.anchor }; options.changed() }
        if (Date.now() < suggestionExpiry) return
      } else {
        suggestionKey = key
        suggestion = { context: { ...context }, field: form.focused, value: { id: randomUUID(), tabId: context.tabId, origin: origin(context), anchor: form.anchor, locked: !vault.hasSession(), items: [] } }
        options.changed()
      }
      suggestionExpiry = Date.now() + 30000
      if (!vault.hasSession()) return
      suggestionCheck = undefined
      await loadSuggestions(context, suggestion.value.id)
    } catch { /* Page transitions cancel discovery without touching the vault session. */ }
    finally { if (suggestionCheck === controller) suggestionCheck = undefined }
  }
  let write = async (attempt: Attempt, context: PluginContext, form: LoginForm) => {
    current(attempt)
    if (attempt.expires && Date.now() >= attempt.expires) throw new Error('Password fill expired')
    if (!options.interactive(context)) throw new Error('Return to the original login tab')
    let login = attempt.login!
    await options.browser('fill', { origin: origin(context), fields: form.fields.map(field => ({ ...field, value: field.role === 'password' ? login.login.password : login.login.username ?? '' })) }, context, attempt.controller.signal)
    current(attempt)
  }
  let schedule = (attempt: Attempt) => {
    if (attempt.controller.signal.aborted) return
    attempt.timer = setTimeout(() => { void continueFill(attempt) }, 250)
    attempt.timer.unref()
  }
  let continueFill = async (attempt: Attempt) => {
    try {
      let context = current(attempt)
      if (Date.now() >= attempt.expires!) { notice(context, 'Password fill expired. Run passwords again.'); cancelAttempt(attempt); return }
      if (attempt.navigating || !options.interactive(context)) { schedule(attempt); return }
      let form = await inspect(context, attempt.controller.signal)
      if (!options.interactive(context)) { schedule(attempt); return }
      if (form.kind === 'occupied' || form.kind === 'ambiguous') { notice(context, 'Password fill stopped. Check the form and run passwords again.'); cancelAttempt(attempt); return }
      if (form.kind === 'password' || form.kind === 'combined') {
        let status = await vault.status(attempt.controller.signal)
        if (status.status !== 'unlocked' || JSON.stringify([status.userId, status.serverUrl]) !== account) { notice(context, 'Bitwarden is locked or the account changed. Run passwords again.'); lock(); return }
        if (!options.interactive(context)) { schedule(attempt); return }
        await write(attempt, context, form)
        notice(context, 'Bitwarden password filled'); cancelAttempt(attempt); return
      }
      schedule(attempt)
    } catch {
      if (attempt.controller.signal.aborted) return
      // A same-origin navigation may replace the document between inspection and fill.
      try { current(attempt) } catch { cancelAttempt(attempt); return }
      if (!options.interactive(attempt.context)) { schedule(attempt); return }
      if (attempt.navigating || options.context(attempt.context).documentId !== attempt.context.documentId) {
        attempt.context = options.context(attempt.context); schedule(attempt)
      } else { notice(attempt.context, 'Password fill stopped. Run passwords again.'); cancelAttempt(attempt) }
    }
  }
  let fill = async (context: PluginContext, signal: AbortSignal, interaction: VaultInteraction, selectedLogin?: string) => {
    if (locked) throw new Error('Unlock your Mac before using Bitwarden')
    if (!context.tabId || !context.profileId || !/^https?:\/\//.test(context.url ?? '')) throw new Error('Open a login page first')
    clearSuggestions()
    for (let other of attempts.values()) if (!other.expires && !options.interactive(other.context)) cancelAttempt(other)
    cancel(context.tabId)
    let attempt: Attempt = { context: { ...context }, controller: new AbortController() }
    attempts.set(context.tabId, attempt)
    let abort = () => cancelAttempt(attempt)
    signal.addEventListener('abort', abort, { once: true })
    let operation = attempt.controller.signal
    let check = () => { signal.throwIfAborted(); current(attempt); if (options.context(context).documentId !== context.documentId) throw new Error('Login page changed') }
    let ask = async (args: Record<string, unknown>) => {
      check()
      // CLI work can outlast a focus transition. Wait for the user to return;
      // never activate a window or redirect the prompt to a different tab.
      while (!options.interactive(context)) {
        await new Promise<void>(resolve => setTimeout(resolve, 100))
        check()
      }
      let aborted: () => void = () => undefined
      try {
        return await Promise.race([interaction.ui(args), new Promise<never>((_resolve, reject) => {
          aborted = () => reject(new Error('Bitwarden fill cancelled'))
          operation.addEventListener('abort', aborted, { once: true })
          if (operation.aborted) aborted()
        })])
      } finally { operation.removeEventListener('abort', aborted) }
    }
    let unlock = async (reprompt = false) => {
      let password = await ask({ kind: 'password', title: reprompt ? 'Verify master password for this login' : 'Unlock Bitwarden', required: true })
      check()
      try { await vault.unlock(String(password), operation) } finally { password = undefined }
      check()
    }
    let exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
      let previous = queue
      let next = previous.catch(() => undefined).then(() => { check(); return action() })
      // Do not retain a resolved login list in the long-lived serialization tail.
      queue = next.then(() => undefined, () => undefined)
      return next
    }
    try {
      check()
      let fresh = !!selectedLogin && freshSelection?.id === selectedLogin && freshSelection.tabId === context.tabId && freshSelection.documentId === context.documentId && Date.now() < freshSelection.expires
      freshSelection = undefined
      let logins = await exclusive(async () => {
        let status = await vault.status(operation)
        check()
        if (status.status === 'unauthenticated') { vault.close(); throw new Error('Run bw login in a terminal, then run passwords again') }
        let identity = JSON.stringify([status.userId, status.serverUrl])
        if (account && account !== identity) { for (let [tabId, other] of attempts) if (other !== attempt) cancel(tabId); vault.close(); status.status = 'locked' }
        if (status.status !== 'unlocked') {
          await unlock(); fresh = true
          status = await vault.status(operation); check()
          if (status.status !== 'unlocked') { vault.close(); throw new Error('Bitwarden did not retain the unlock. Try again.') }
        }
        account = JSON.stringify([status.userId, status.serverUrl])
        try { return await vault.logins(origin(context), operation) }
        catch { throw new Error('Could not read Bitwarden. Try passwords again; your unlock is retained while the session is valid.') }
      })
      check()
      if (!logins.length) throw new Error('No Bitwarden logins match this exact origin')
      let id = selectedLogin ?? await ask({ kind: 'pick', title: `Login for ${origin(context)}`, items: logins.map(item => ({ id: item.id, label: item.name || 'Login', description: item.login.username || '' })) })
      check()
      attempt.login = logins.find(item => item.id === id)
      logins = []
      if (!attempt.login) throw new Error('Login selection cancelled')
      if (attempt.login.reprompt === 1 && !fresh) await exclusive(() => unlock(true))
      if (origin(context).startsWith('http:') && !await ask({ kind: 'confirm', title: 'Fill this login over unencrypted HTTP?' })) { cancelAttempt(attempt); return { filled: false } }
      check()
      let form = await inspect(context, operation)
      if (!form.fields.length) throw new Error(form.kind === 'occupied' ? 'Password already entered. Clear it to fill from Bitwarden.' : 'Could not identify one login form. Open the username or password step and try again.')
      if (form.kind === 'username' && !attempt.login.login.username) throw new Error('This Bitwarden login has no username')
      await write(attempt, context, form)
      if (form.kind === 'username') {
        attempt.expires = Date.now() + 120000
        interaction.progress('Username filled. Click Next; bmux will fill the password. Use passwords cancel to stop.')
        notice(context, 'Username filled. Click Next; the password will fill automatically.')
        schedule(attempt)
        return { filled: true, waitingForPassword: true }
      }
      notice(context, 'Bitwarden login filled'); cancel(context.tabId)
      return { filled: true }
    } catch (error) {
      let message = error instanceof Error && !operation.aborted ? error.message : 'Bitwarden fill cancelled'
      cancelAttempt(attempt)
      notice(context, message); interaction.progress(message)
      throw new Error(message)
    } finally { signal.removeEventListener('abort', abort) }
  }
  return {
    fill, lock, suggest, clearSuggestions,
    suggestions: (clientId: string) => {
      if (!suggestion || suggestion.context.clientId !== clientId || !(options.selected ?? options.interactive)(suggestion.context)) return undefined
      try {
        let next = options.context(suggestion.context)
        return next.documentId === suggestion.context.documentId && next.url === suggestion.context.url && next.profileId === suggestion.context.profileId ? suggestion.value : undefined
      } catch { return undefined }
    },
    loadSuggestions,
    prepare: async (context: PluginContext, suggestionId: string) => {
      let entry = await validSuggestion(context, suggestionId)
      entry.value = { ...entry.value, expanded: true }; options.changed()
    },
    dismiss: () => { dismissedKey = suggestionKey; clearSuggestions() },
    select: async (context: PluginContext, id: string, suggestionId = suggestion?.value.id ?? '') => {
      let entry = await validSuggestion(context, suggestionId)
      if (entry.value.locked || entry.value.busy || !entry.value.items.some(item => item.id === id)) throw new Error('Password suggestion expired')
      if (entry.fresh) freshSelection = { id, tabId: context.tabId, documentId: context.documentId, expires: entry.fresh }
      clearSuggestions()
      return id
    },
    cancel: (tabId: string) => { let attempt = attempts.get(tabId); if (attempt) notice(attempt.context, 'Password fill cancelled'); cancel(tabId) },
    systemLock: () => { locked = true; lock() },
    systemUnlock: () => { locked = false },
    navigation: (tabId: string, url: string, ready = false) => {
      if (suggestion?.context.tabId === tabId || suggestionCheck) clearSuggestions()
      let attempt = attempts.get(tabId)
      if (!attempt) return
      if (!attempt.expires || origin({ url }) !== origin(attempt.context)) { cancel(tabId); return }
      attempt.navigating = !ready
    },
    message: (clientId: string) => {
      let entry = notices.get(clientId)
      if (!entry) return undefined
      try { return options.context({ clientId }).tabId === entry.tabId ? entry.message : undefined } catch { return undefined }
    },
    close: () => { lock(); for (let entry of notices.values()) clearTimeout(entry.timer); notices.clear() },
  }
}
