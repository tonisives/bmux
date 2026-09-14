import { afterEach, expect, test, vi } from 'vitest'
import { createBitwarden } from '../src/main/bitwarden'
import type { VaultLogin } from '../src/main/bitwarden-cli'
import type { LoginForm } from '../src/main/bitwarden-fields'
import type { PluginContext } from '../src/shared/plugins'

let cleanup: (() => void)[] = []
afterEach(() => { for (let close of cleanup.splice(0)) close(); vi.useRealTimers() })
let setup = () => {
  vi.useFakeTimers()
  let context: PluginContext = { clientId: 'client', tabId: 'tab', profileId: 'profile', documentId: '1', url: 'https://example.test/login' }
  let login: VaultLogin = { id: 'fixture', name: 'Fixture', type: 1, login: { username: 'fixture-user', password: 'fixture-password' } }
  let unlocked = false, visible = true
  let form: LoginForm = { kind: 'combined', fields: [{ selector: '#user', role: 'username', expectedType: 'text' }, { selector: '#pass', role: 'password', expectedType: 'password', requireEmpty: true }] }
  let vault = {
    hasSession: () => unlocked,
    status: vi.fn(async () => ({ status: unlocked ? 'unlocked' : 'locked', userId: 'account', serverUrl: 'https://vault.example.test' })),
    unlock: vi.fn(async () => { unlocked = true }), logins: vi.fn(async () => [login]), close: vi.fn(() => { unlocked = false }),
  }
  let browser = vi.fn(async (method: string) => method === 'eval' ? form : { filled: form.fields.length })
  let service = createBitwarden({ vault, context: target => ({ ...context, tabId: target.tabId ?? context.tabId }), interactive: () => visible, selected: () => true, browser, changed: vi.fn() })
  let ui = vi.fn(async (args: Record<string, unknown>): Promise<unknown> => args.kind === 'password' ? 'fixture-master' : args.kind === 'pick' ? login.id : true)
  let progress = vi.fn()
  let fill = (signal = new AbortController().signal, target = { ...context }) => service.fill(target, signal, { ui, progress })
  cleanup.push(service.close)
  return { service, fill, context, login, vault, browser, ui, progress, focus: (selector?: string) => { form.focused = selector; form.anchor = selector ? { x: 40, y: 60, width: 220, height: 30 } : undefined }, show: (value: boolean) => visible = value, form: (kind: LoginForm['kind']) => { form = { kind, fields: kind === 'username' ? [{ selector: '#user', role: 'username', expectedType: 'text' }] : kind === 'password' ? [{ selector: '#pass', role: 'password', expectedType: 'password', requireEmpty: true }] : [] } }, fills: () => browser.mock.calls.filter(call => call[0] === 'fill').length }
}

test('reuses an unlock across independent fills and clears it on explicit or system lock', async () => {
  let f = setup()
  await f.fill(); await f.fill()
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  f.service.lock(); await f.fill()
  expect(f.vault.unlock).toHaveBeenCalledTimes(2)
  f.service.systemLock()
  await expect(f.fill()).rejects.toThrow('Unlock your Mac')
  f.service.systemUnlock(); await f.fill()
  expect(f.vault.unlock).toHaveBeenCalledTimes(3)
})

test('an explicit password action opens unlock before checking CLI status', async () => {
  let f = setup()
  f.ui.mockImplementationOnce(async args => {
    expect(args).toMatchObject({ kind: 'password', title: 'Unlock Bitwarden' })
    expect(f.vault.status).not.toHaveBeenCalled()
    return 'fixture-master'
  })
  await f.fill()
  expect(f.vault.status).toHaveBeenCalledTimes(1)
})

test('a fresh unlock satisfies reprompt, but a later selection requires a fresh check', async () => {
  let f = setup(); f.login.reprompt = 1
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(2)
  expect(f.ui).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Verify master password for this login' }))
})

test('serializes concurrent unlocks without serializing browser operations', async () => {
  let f = setup()
  await Promise.all([f.fill(), f.fill(undefined, { ...f.context, tabId: 'tab-other' })])
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  expect(f.fills()).toBe(2)
})

test('continues a username flow without another prompt and fills the password only once', async () => {
  let f = setup(); f.form('username')
  expect(await f.fill()).toEqual({ filled: true, waitingForPassword: true })
  let prompts = f.ui.mock.calls.length
  f.form('password'); await vi.advanceTimersByTimeAsync(500)
  expect(f.fills()).toBe(2); expect(f.ui).toHaveBeenCalledTimes(prompts)
  await vi.advanceTimersByTimeAsync(1000); expect(f.fills()).toBe(2)
  expect(f.service.message('client')).toBe('Bitwarden password filled')
})

test('pauses in background and resumes across same-origin navigation with a fresh document', async () => {
  let f = setup(); f.form('username'); await f.fill()
  f.service.navigation('tab', 'https://example.test/password')
  f.context.url = 'https://example.test/password'; f.context.documentId = '2'; f.form('password')
  await vi.advanceTimersByTimeAsync(500); expect(f.fills()).toBe(1)
  f.service.navigation('tab', f.context.url, true); f.show(false)
  await vi.advanceTimersByTimeAsync(500); expect(f.fills()).toBe(1)
  f.show(true); await vi.advanceTimersByTimeAsync(500); expect(f.fills()).toBe(2)
})

test.each(['cross-origin', 'profile', 'cancel', 'lock', 'expiry', 'occupied', 'ambiguous', 'external-lock'])('stops pending fills on %s', async reason => {
  let f = setup(); f.form('username'); await f.fill(); f.form('password')
  if (reason === 'cross-origin') { f.service.navigation('tab', 'https://elsewhere.test'); f.service.navigation('tab', f.context.url!, true) }
  if (reason === 'profile') f.context.profileId = 'other-profile'
  if (reason === 'cancel') f.service.cancel('tab')
  if (reason === 'lock') f.service.lock()
  if (reason === 'expiry') { f.show(false); await vi.advanceTimersByTimeAsync(120001); f.show(true) }
  if (reason === 'occupied' || reason === 'ambiguous') f.form(reason)
  if (reason === 'external-lock') f.vault.close()
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.fills()).toBe(1)
})

test('cancelling a pending unlock releases the prompt wait and permits a subsequent fill', async () => {
  let f = setup(), requested = false
  f.ui.mockImplementationOnce(async () => { requested = true; return new Promise(() => undefined) })
  let pending = f.fill(); let rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(requested).toBe(true))
  f.service.lock(); await rejected
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

test('a superseded attempt cannot cancel the replacement in the same tab', async () => {
  let f = setup(), requested = false
  f.ui.mockImplementationOnce(async () => { requested = true; return new Promise(() => undefined) })
  let first = f.fill(); let rejected = expect(first).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(requested).toBe(true))
  let second = f.fill(); await rejected; await second
  expect(f.fills()).toBe(1)
})

test('transient lookup failures retain the unlock, while an invalidated session requires unlocking', async () => {
  let f = setup(); await f.fill()
  f.vault.logins.mockRejectedValueOnce(new Error('private CLI failure'))
  await expect(f.fill()).rejects.toThrow('Could not read Bitwarden')
  expect(JSON.stringify(f.progress.mock.calls)).not.toContain('private CLI failure')
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  f.vault.close(); await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(2)
})

test('waits through a focus transition before presenting a vault prompt', async () => {
  let f = setup(); f.show(false)
  let pending = f.fill()
  await vi.advanceTimersByTimeAsync(300)
  expect(f.ui).not.toHaveBeenCalled()
  f.show(true); await vi.advanceTimersByTimeAsync(150); await pending
  expect(f.fills()).toBe(1)
})


test('focusing a login field offers unlocking, then account labels without exposing passwords', async () => {
  let f = setup(); f.focus('#user')
  await f.service.suggest(f.context)
  expect(f.vault.status).not.toHaveBeenCalled()
  expect(f.vault.logins).not.toHaveBeenCalled()
  expect(f.ui).not.toHaveBeenCalled()
  expect(f.service.suggestions('client')).toMatchObject({ tabId: 'tab', origin: 'https://example.test', locked: true, items: [] })
  await expect(f.service.select(f.context, 'fixture')).rejects.toThrow('expired')
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  expect(f.service.suggestions('client')?.items).toHaveLength(1)
  f.ui.mockClear(); f.focus('#user')
  await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.locked).toBe(false)
  expect(f.service.suggestions('client')?.items).toEqual([{ id: 'fixture', name: 'Fixture', username: 'fixture-user' }])
  expect(JSON.stringify(f.service.suggestions('client'))).not.toContain('fixture-password')
  expect(f.ui).not.toHaveBeenCalled()
  let lookups = f.vault.logins.mock.calls.length
  await f.service.suggest(f.context)
  expect(f.vault.logins).toHaveBeenCalledTimes(lookups)
  let selected = await f.service.select(f.context, 'fixture')
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.ui).not.toHaveBeenCalled()
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

for (let unlocked of [false, true]) {
  test.each(['field', 'document', 'profile', 'background', 'lock'])(`rejects an ${unlocked ? 'account' : 'unlock'} suggestion after changing %s`, async reason => {
    let f = setup(); if (unlocked) await f.fill()
    f.focus('#user'); await f.service.suggest(f.context)
    let suggestionId = f.service.suggestions('client')!.id
    if (reason === 'field') f.focus('#other')
    if (reason === 'document') f.context.documentId = '2'
    if (reason === 'profile') f.context.profileId = 'other-profile'
    if (reason === 'background') f.show(false)
    if (reason === 'lock') f.service.lock()
    if (unlocked) await expect(f.service.select(f.context, 'fixture')).rejects.toThrow()
    else await expect(f.service.loadSuggestions(f.context, suggestionId, 'fixture-master')).rejects.toThrow()
    expect(f.fills()).toBe(unlocked ? 1 : 0)
  })
}

test('leaving a login field hides suggestions and locking never opens an automatic prompt', async () => {
  let f = setup(); await f.fill(); f.ui.mockClear(); f.focus('#user'); await f.service.suggest(f.context)
  f.focus(); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toBeUndefined()
  f.focus('#user'); await f.service.suggest(f.context)
  f.service.lock(); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.locked).toBe(true)
  f.focus(); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toBeUndefined()
  f.focus('#user'); f.service.systemLock(); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toBeUndefined()
  expect(f.ui).not.toHaveBeenCalled()
})

test('a lookup that finishes after navigation cannot publish suggestions or clear the session', async () => {
  let f = setup(); await f.fill(); f.focus('#user')
  let finish!: (logins: VaultLogin[]) => void
  f.vault.logins.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let pending = f.service.suggest(f.context)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.service.navigation('tab', 'https://elsewhere.test')
  finish([f.login]); await pending
  expect(f.service.suggestions('client')).toBeUndefined()
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

test('cancelling the picker after unlocking retains the session for field suggestions', async () => {
  let f = setup(); f.ui.mockImplementation(async args => args.kind === 'password' ? 'fixture-master' : undefined)
  await expect(f.fill()).rejects.toThrow('cancelled')
  f.focus('#user'); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.items).toHaveLength(1)
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

test('unlocking loads choices immediately and refocusing keeps the same unlocked vault', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  expect(f.service.suggestions('client')).toMatchObject({ locked: false, busy: false, items: [{ id: 'fixture' }] })
  f.focus(); await f.service.suggest(f.context)
  f.focus('#user'); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.items).toHaveLength(1)
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  expect(f.ui).not.toHaveBeenCalled()
})

test.each(['empty', 'failure'])('an unlocked %s lookup has a visible result and retains the session', async mode => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  if (mode === 'empty') f.vault.logins.mockResolvedValueOnce([])
  else f.vault.logins.mockRejectedValueOnce(new Error('private CLI failure'))
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  let result = f.service.suggestions('client')!
  expect(result).toMatchObject({ locked: false, busy: false, items: [] })
  if (mode === 'failure') expect(result.message).toContain('still unlocked')
  expect(JSON.stringify(result)).not.toContain('private CLI failure')
  await f.service.loadSuggestions(f.context, result.id)
  expect(f.service.suggestions('client')?.items).toHaveLength(1)
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

test('an unlock that returns an unusable session is reported in the popup', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  f.vault.unlock.mockImplementationOnce(async () => undefined)
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  expect(f.service.suggestions('client')).toMatchObject({ locked: true, busy: false, items: [], message: 'Bitwarden did not retain the unlock. Try again.' })
  expect(f.vault.logins).not.toHaveBeenCalled()
})

test('dismissal lasts until the login field is left, and stale popup actions are rejected', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let old = f.service.suggestions('client')!.id
  f.service.dismiss(); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toBeUndefined()
  f.focus(); await f.service.suggest(f.context)
  f.focus('#user'); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.id).not.toBe(old)
  await expect(f.service.loadSuggestions(f.context, old, 'fixture-master')).rejects.toThrow('expired')
  expect(f.vault.unlock).not.toHaveBeenCalled()
})

test('navigation during a slow unlock cannot publish accounts on another document', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let finish!: () => void
  f.vault.unlock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  let pending = f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.service.navigation('tab', 'https://elsewhere.test'); f.context.documentId = '2'
  finish(); await pending
  expect(f.service.suggestions('client')).toBeUndefined()
  expect(f.vault.logins).not.toHaveBeenCalled()
})

test('a focus change during continuation inspection pauses until the original tab returns', async () => {
  let f = setup(); f.form('username'); await f.fill(); f.form('password')
  f.browser.mockImplementationOnce(async () => { f.show(false); throw new Error('Page changed during focus transition') })
  await vi.advanceTimersByTimeAsync(300)
  expect(f.fills()).toBe(1)
  f.show(true); await vi.advanceTimersByTimeAsync(500)
  expect(f.fills()).toBe(2)
})

test('a fill records the account reported by post-unlock verification', async () => {
  let f = setup()
  await f.fill(); f.focus('#user'); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toMatchObject({ locked: false, items: [{ id: 'fixture' }] })
  expect(f.vault.unlock).toHaveBeenCalledTimes(1)
})

test('an expired session returns to the unlock offer without automatically focusing a password prompt', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let popupId = f.service.suggestions('client')!.id
  await f.service.prepare(f.context, popupId)
  await f.service.loadSuggestions(f.context, popupId, 'fixture-master')
  f.vault.status.mockResolvedValueOnce({ status: 'locked', userId: 'account', serverUrl: 'https://vault.example.test' })
  await vi.advanceTimersByTimeAsync(30001); await f.service.suggest(f.context)
  expect(f.service.suggestions('client')).toMatchObject({ locked: true, expanded: false, busy: false })
  expect(f.ui).not.toHaveBeenCalled()
})

test('an immediate popup selection uses its fresh unlock for one master-password reprompt', async () => {
  let f = setup(); f.login.reprompt = 1; f.focus('#user'); await f.service.suggest(f.context)
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  let selected = await f.service.select(f.context, 'fixture')
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.ui).not.toHaveBeenCalled()
  await f.fill()
  expect(f.vault.unlock).toHaveBeenCalledTimes(2)
})

test('an old popup unlock no longer satisfies an entry master-password reprompt', async () => {
  let f = setup(); f.login.reprompt = 1; f.focus('#user'); await f.service.suggest(f.context)
  await f.service.loadSuggestions(f.context, f.service.suggestions('client')!.id, 'fixture-master')
  await vi.advanceTimersByTimeAsync(120001)
  let selected = await f.service.select(f.context, 'fixture')
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.ui).toHaveBeenCalledWith(expect.objectContaining({ title: 'Verify master password for this login' }))
})


test('an expanded popup survives app defocus and completes lookup in the background', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.prepare(f.context, id)
  f.show(false)
  expect(f.service.suggestions('client')).toMatchObject({ id, expanded: true })
  f.show(true)
  f.vault.logins.mockImplementationOnce(async () => { f.show(false); return [f.login] })
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  expect(f.service.suggestions('client')).toMatchObject({ id, locked: false, busy: false, items: [{ id: 'fixture' }] })
  await expect(f.service.select(f.context, 'fixture', id)).rejects.toThrow('expired')
  f.show(true)
  expect(await f.service.select(f.context, 'fixture', id)).toBe('fixture')
})

test('selecting a popup login tolerates the page losing input focus while retaining the original field', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  f.focus()
  let selected = await f.service.select(f.context, 'fixture', id)
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.fills()).toBe(1)
})


test('a discovery check finishing after defocus preserves the existing popup', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  f.browser.mockImplementationOnce(async () => {
    f.show(false)
    return { kind: 'combined', fields: [] }
  })
  await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.id).toBe(id)
  await f.service.suggest(f.context)
  expect(f.service.suggestions('client')?.id).toBe(id)
})


test('popup selection reuses the displayed login while still checking the vault session', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  let lookups = f.vault.logins.mock.calls.length, checks = f.vault.status.mock.calls.length
  let selected = await f.service.select(f.context, 'fixture', id)
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.vault.logins).toHaveBeenCalledTimes(lookups)
  expect(f.vault.status).toHaveBeenCalledTimes(checks + 1)
  expect(f.fills()).toBe(1)
})

test('expired popup credentials are fetched again before filling', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  await vi.advanceTimersByTimeAsync(30001)
  let lookups = f.vault.logins.mock.calls.length
  let selected = await f.service.select(f.context, 'fixture', id)
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.vault.logins).toHaveBeenCalledTimes(lookups + 1)
})

test('unlock and item loading take two CLI intervals instead of four', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  let unlock = f.vault.unlock.getMockImplementation()!, status = f.vault.status.getMockImplementation()!
  let delay = () => new Promise<void>(resolve => setTimeout(resolve, 1000))
  f.vault.unlock.mockImplementation(async () => { await delay(); await unlock() })
  f.vault.status.mockImplementation(async () => { await delay(); return status() })
  f.vault.logins.mockImplementation(async () => { await delay(); return [f.login] })
  let completed = false
  let pending = f.service.loadSuggestions(f.context, id, 'fixture-master').then(() => { completed = true })
  await vi.advanceTimersByTimeAsync(2000)
  expect(completed).toBe(true)
  await pending
  expect(f.vault.status).toHaveBeenCalledTimes(1)
  expect(f.service.suggestions('client')?.items).toHaveLength(1)
})

test.each(['lock', 'account', 'selection expiry'])('a popup credential is not reused after %s', async reason => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  let selected = await f.service.select(f.context, 'fixture', id)
  let lookups = f.vault.logins.mock.calls.length
  if (reason === 'lock') f.service.lock()
  if (reason === 'account') f.vault.status.mockImplementation(async () => ({ status: 'unlocked', userId: 'another-account', serverUrl: 'https://vault.example.test' }))
  if (reason === 'selection expiry') await vi.advanceTimersByTimeAsync(5001)
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.vault.logins).toHaveBeenCalledTimes(lookups + 1)
})


test('a changed vault revision refreshes a previously selected credential', async () => {
  let f = setup(); f.focus('#user'); await f.service.suggest(f.context)
  let id = f.service.suggestions('client')!.id
  await f.service.loadSuggestions(f.context, id, 'fixture-master')
  let selected = await f.service.select(f.context, 'fixture', id), lookups = f.vault.logins.mock.calls.length
  f.vault.status.mockImplementation(async () => ({ status: 'unlocked', userId: 'account', serverUrl: 'https://vault.example.test', revision: 'new-vault-revision' }))
  await f.service.fill(f.context, new AbortController().signal, { ui: f.ui, progress: f.progress }, selected)
  expect(f.vault.logins).toHaveBeenCalledTimes(lookups + 1)
})
