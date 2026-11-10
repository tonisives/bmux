import fs from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { lockedPaneInventory } from './locked-pane-inventory'

type Pane = ReturnType<typeof lockedPaneInventory>[number]
export type AccountConfiguration = { revision: string; fields: unknown[]; values: Record<string, unknown>; profiles?: unknown; summary: string[] }
export type AccountSettingsOperation = { revision: string; values?: Record<string, unknown>; profile?: Record<string, unknown> }
export type AccountSettingsCommand = { id: string; key: string; identity: Pane['identity']; operation: AccountSettingsOperation }
export let createAccountRelayControl = (directory: string, panes: () => Pane[], configure: (platform: string, profileId: string, operation?: AccountSettingsOperation) => Promise<AccountConfiguration>) => {
  let receipts = path.join(directory, 'account-settings-receipts.json'), chain = Promise.resolve()
  let inventory = async () => {
    let definitions: { profileId: string; platform: string; automations: unknown[] }[] = []
    try { let file = await fs.readFile(path.join(directory, 'account-automations.json'), 'utf8'); if (file.length <= 65536) definitions = JSON.parse(file) } catch { /* Optional external scheduler reports. */ }
    return (await Promise.all(panes().slice(0, 16).map(async pane => {
      try {
        let configuration = await configure(pane.platform, pane.identity.profileId)
        let automations = Array.isArray(definitions) ? definitions.find(item => item.profileId === pane.identity.profileId && item.platform === pane.platform)?.automations ?? [] : []
        return { key: pane.key, configuration, automations }
      } catch { return undefined }
    }))).filter(item => item !== undefined)
  }
  let execute = async (command: AccountSettingsCommand) => {
    let saved: Record<string, { id: string; status: string; error?: string }> = {}
    try { saved = JSON.parse(await fs.readFile(receipts, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (Object.hasOwn(saved, command.id)) return saved[command.id]
    let result: { id: string; status: string; error?: string } = { id: command.id, status: 'failed', error: 'Settings were not applied; refresh and retry' }
    saved = Object.fromEntries(Object.entries(saved).slice(-99)); saved[command.id] = result
    let temporary = receipts + '.tmp'
    await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }); await fs.rename(temporary, receipts)
    let pane = panes().find(pane => pane.key === command.key)
    if (pane && isDeepStrictEqual(pane.identity, command.identity)) {
      try { await configure(pane.platform, pane.identity.profileId, command.operation); result = { id: command.id, status: 'applied' } } catch { /* Return only a fixed error, never plugin process output. */ }
    } else result.error = 'Account identity changed; refresh before saving'
    saved[command.id] = result
    await fs.writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }); await fs.rename(temporary, receipts)
    return result
  }
  let apply = (command: AccountSettingsCommand) => {
    let pending = chain.then(() => execute(command))
    chain = pending.then(() => undefined, () => undefined)
    return pending
  }
  return { inventory, apply }
}
