import fs from 'node:fs/promises'
import path from 'node:path'
import { accountFingerprint } from './locked-pane-inventory'
import type { AccountSeal } from '../shared/types'

export type AccountJob = { id: string; account: string; identity: AccountSeal['identity']; action: string; inputs: Record<string, unknown>; deadline: number }
export type AccountJobReceipt = { id: string; status: 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled'; error?: string }
type Saved = AccountJobReceipt & { fingerprint: string; deadline: number }
type Handle = { renew: () => void; release: () => void; start: (guard: () => void) => void | Promise<void>; status: () => string; cancel: () => void }
type Options = { directory: string; acquire: (job: AccountJob) => Handle; changed: () => void }

export let createAccountJobs = (options: Options) => {
  let file = path.join(options.directory, 'account-job-receipts.json'), saved: Record<string, Saved> = {}, active = new Map<string, { handle: Handle; valid: () => boolean }>(), closed = false
  let persist = async () => { await fs.writeFile(file + '.tmp', JSON.stringify(saved), { mode: 0o600, flush: true }); await fs.rename(file + '.tmp', file) }
  let ready = (async () => {
    try { saved = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!saved || Array.isArray(saved) || typeof saved !== 'object' || Object.values(saved).some(item => !item || typeof item.fingerprint !== 'string' || !Number.isFinite(item.deadline))) throw new Error('ACCOUNT_JOURNAL_INVALID')
    for (let [id, item] of Object.entries(saved)) {
      if (item.deadline < Date.now() - 7 * 86400000) delete saved[id]
      else if (item.status === 'running') { item.status = 'interrupted'; item.error = 'HOST_RESTARTED' }
    }
    await persist()
  })()
  void ready.catch(() => undefined)
  let chain = ready
  let serial = <T>(operation: () => Promise<T>) => { let result = chain.then(operation); chain = result.then(() => undefined, () => undefined); return result }
  let receipt = (value: Saved): AccountJobReceipt => ({ id: value.id, status: value.status, ...(value.error ? { error: value.error } : {}) })
  let finish = async (id: string, status: AccountJobReceipt['status'], error?: string) => {
    let run = active.get(id)
    if (!run) return
    active.delete(id)
    try { if (status !== 'succeeded') run.handle.cancel() } finally { run.handle.release() }
    saved[id] = { ...saved[id], status, ...(error ? { error } : {}) }
    await persist(); options.changed()
  }
  let accept = (job: AccountJob, valid: () => boolean) => serial(async () => {
    if (closed || !valid()) throw new Error('ACCOUNT_REQUEST_EXPIRED')
    if (!/^[a-f0-9-]{36}$/.test(job.id) || !/^[a-f0-9-]{36}$/.test(job.account) || !Number.isFinite(job.deadline) || !job.inputs || Array.isArray(job.inputs) || typeof job.inputs !== 'object' || JSON.stringify(job.inputs).length > 16000) throw new Error('ACCOUNT_JOB_INVALID')
    let fingerprint = accountFingerprint(job), existing = saved[job.id]
    if (existing) { if (existing.fingerprint !== 'cancelled' && existing.fingerprint !== fingerprint) throw new Error('ACCOUNT_JOB_CHANGED'); return receipt(existing) }
    if (job.deadline <= Date.now() || job.deadline > Date.now() + 180 * 60000) throw new Error('ACCOUNT_JOB_EXPIRED')
    if (Object.keys(saved).length >= 10000) throw new Error('ACCOUNT_JOURNAL_FULL')
    let handle = options.acquire(job)
    saved[job.id] = { id: job.id, status: 'running', fingerprint, deadline: job.deadline }
    try { await persist() } catch (error) { delete saved[job.id]; handle.release(); throw error }
    let guard = () => { if (closed || !valid() || Date.now() >= job.deadline || !active.has(job.id)) throw new Error('ACCOUNT_EXECUTION_EXPIRED'); handle.renew() }
    active.set(job.id, { handle, valid })
    try { guard(); await handle.start(guard) } catch { await finish(job.id, 'failed', 'PLUGIN_START_FAILED') }
    options.changed()
    return receipt(saved[job.id])
  })
  let cancel = (id: string) => serial(async () => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('ACCOUNT_JOB_INVALID')
    if (!saved[id]) {
      if (Object.keys(saved).length >= 10000) throw new Error('ACCOUNT_JOURNAL_FULL')
      saved[id] = { id, status: 'cancelled', fingerprint: 'cancelled', deadline: Date.now() + 180 * 60000 }
      await persist(); options.changed()
    } else await finish(id, 'cancelled')
    return receipt(saved[id])
  })
  let tick = () => serial(async () => {
    for (let [id, run] of active) {
      let status = run.handle.status()
      if (status === 'completed') await finish(id, 'succeeded')
      else if (closed || !run.valid()) await finish(id, 'interrupted', 'RELAY_DISCONNECTED')
      else if (Date.now() >= saved[id].deadline) await finish(id, 'interrupted', 'EXECUTION_DEADLINE')
      else if (status === 'failed' || status === 'cancelled') await finish(id, status === 'failed' ? 'failed' : 'cancelled', status === 'failed' ? 'PLUGIN_FAILED' : undefined)
      else { try { run.handle.renew() } catch { await finish(id, 'interrupted', 'CONTROL_EXPIRED') } }
    }
  })
  let timer = setInterval(() => { void tick().catch(() => { closed = true; for (let run of active.values()) { run.handle.cancel(); run.handle.release() }; active.clear() }) }, 1000)
  timer.unref()
  return { accept, cancel, receipts: async () => { await chain; return Object.values(saved).slice(-100).map(receipt) }, close: async () => { closed = true; clearInterval(timer); await tick() } }
}
