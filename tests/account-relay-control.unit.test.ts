import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAccountRelayControl } from '../src/main/account-relay-control'
import { lockedPaneInventory } from '../src/main/locked-pane-inventory'
import { initialModel } from '../src/main/model'
let directories: string[] = []
afterEach(async () => { for (let directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'account-settings-')); directories.push(directory)
  let model = initialModel(), window = model.sessions[0].windows[0], pane = window.panes[0]
  window.locked = true; window.lockedViewports = { [pane.id]: { width: 1200, height: 900 } }; pane.url = 'https://x.com/home'
  let configure = vi.fn(async () => ({ revision: 'a'.repeat(64), fields: [], values: { ai_daily_limit: '500' }, summary: [] }))
  let create = () => createAccountRelayControl(directory, () => lockedPaneInventory(model), configure)
  let inventory = lockedPaneInventory(model), command = { id: 'fixture', key: pane.id, identity: inventory[0].identity, operation: { revision: 'a'.repeat(64), values: { ai_daily_limit: '500' } } }
  return { directory, model, configure, create, command }
}
it('reports only declared plugin settings and matching external schedules', async () => {
  let f = await fixture()
  await fs.writeFile(path.join(f.directory, 'account-automations.json'), JSON.stringify([{ profileId: f.command.identity.profileId, platform: 'x', automations: [{ id: 'research', name: 'Research' }] }]))
  let reports = await f.create().inventory()
  expect(reports[0]?.configuration.values.ai_daily_limit).toBe('500')
  expect(reports[0]?.automations).toEqual([{ id: 'research', name: 'Research' }])
})
it('deduplicates command results across reconnects and host restarts', async () => {
  let f = await fixture()
  expect(await f.create().apply(f.command)).toEqual({ id: 'fixture', status: 'applied' })
  expect(await f.create().apply(f.command)).toEqual({ id: 'fixture', status: 'applied' })
  expect(f.configure).toHaveBeenCalledTimes(1)
})
it('refuses a changed identity and keeps process diagnostics out of results', async () => {
  let f = await fixture()
  f.command.identity.profileId = 'other'
  expect((await f.create().apply(f.command)).status).toBe('failed'); expect(f.configure).not.toHaveBeenCalled()
  let g = await fixture(); g.configure.mockRejectedValueOnce(new Error('private-output'))
  expect(JSON.stringify(await g.create().apply(g.command))).not.toContain('private-output')
})
