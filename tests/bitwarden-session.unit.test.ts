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
    status: vi.fn(async () => ({ status: unlocked ? 'unlocked' : 'locked', userId: 'account', serverUrl: 'https://vault.example.test' })),
    unlock: vi.fn(async () => { unlocked = true }), logins: vi.fn(async () => [login]), close: vi.fn(() => { unlocked = false }),
  }
  let browser = vi.fn(async (method: string) => method === 'eval' ? form : { filled: form.fields.length })
  let service = createBitwarden({ vault, context: target => ({ ...context, tabId: target.tabId ?? context.tabId }), interactive: () => visible, browser, changed: vi.fn() })
  let ui = vi.fn(async (args: Record<string, unknown>): Promise<unknown> => args.kind === 'password' ? 'fixture-master' : args.kind === 'pick' ? login.id : true)
  let progress = vi.fn()
  let fill = (signal = new AbortController().signal, target = { ...context }) => service.fill(target, signal, { ui, progress })
  cleanup.push(service.close)
  return { service, fill, context, login, vault, browser, ui, progress, show: (value: boolean) => visible = value, form: (kind: LoginForm['kind']) => { form = { kind, fields: kind === 'username' ? [{ selector: '#user', role: 'username', expectedType: 'text' }] : kind === 'password' ? [{ selector: '#pass', role: 'password', expectedType: 'password', requireEmpty: true }] : [] } }, fills: () => browser.mock.calls.filter(call => call[0] === 'fill').length }
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

test('a fresh unlock satisfies reprompt, but a later selection requires a fresh check', async () => {
  let f = setup(); f.login.reprompt = 1
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(1)
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(2)
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

test('invalid sessions clear the cache and request unlocking on the next invocation', async () => {
  let f = setup(); await f.fill()
  f.vault.logins.mockRejectedValueOnce(new Error('private CLI failure'))
  await expect(f.fill()).rejects.toThrow('Could not read Bitwarden')
  expect(JSON.stringify(f.progress.mock.calls)).not.toContain('private CLI failure')
  await f.fill(); expect(f.vault.unlock).toHaveBeenCalledTimes(2)
})

test('waits through a focus transition before presenting a vault prompt', async () => {
  let f = setup(); f.show(false)
  let pending = f.fill()
  await vi.advanceTimersByTimeAsync(300)
  expect(f.ui).not.toHaveBeenCalled()
  f.show(true); await vi.advanceTimersByTimeAsync(150); await pending
  expect(f.fills()).toBe(1)
})
