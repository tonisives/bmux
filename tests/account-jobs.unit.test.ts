import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createAccountJobs } from '../src/main/account-jobs'
import type { AccountJob } from '../src/main/account-jobs'

let directories: string[] = [], hosts: ReturnType<typeof createAccountJobs>[] = []
afterEach(async () => { for (let host of hosts.splice(0)) await host.close(); vi.useRealTimers(); for (let directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'account-jobs-')); directories.push(directory)
  let status = 'running', guard: (() => void) | undefined
  let handle = { renew: vi.fn(), release: vi.fn(), start: vi.fn((value: () => void) => { guard = value }), status: () => status, cancel: vi.fn() }
  let acquire = vi.fn(() => handle), changed = vi.fn()
  let create = () => { let host = createAccountJobs({ directory, acquire, changed }); hosts.push(host); return host }
  let host = create(), valid = true
  let job: AccountJob = { id: '10000000-0000-4000-8000-000000000001', account: '20000000-0000-4000-8000-000000000001', identity: { sessionId: 's', windowId: 'w', paneId: '%1', profileId: 'p', connectionId: 'c', viewport: { width: 1200, height: 800 }, locked: true, network: 'proxy', settingsHash: 'saved' }, action: 'bmux.tiktok/publish-post', inputs: { text: 'Fixture' }, deadline: Date.now() + 60000 }
  return { host, create, job, acquire, handle, guard: () => guard!(), valid: () => valid, disconnect: () => { valid = false }, complete: () => { status = 'completed' } }
}
it('deduplicates delivery and completion across host restarts', async () => {
  vi.useFakeTimers()
  let f = await fixture()
  expect((await f.host.accept(f.job, f.valid)).status).toBe('running')
  await f.host.accept(structuredClone(f.job), f.valid)
  expect(f.handle.start).toHaveBeenCalledTimes(1)
  f.complete(); await vi.advanceTimersByTimeAsync(1001)
  expect((await f.host.receipts())[0].status).toBe('succeeded')
  expect(f.handle.release).toHaveBeenCalledTimes(1)
  await f.host.close()
  expect((await f.create().accept(f.job, f.valid)).status).toBe('succeeded')
  expect(f.handle.start).toHaveBeenCalledTimes(1)
})
it('records interruption before accepting a repeated job after restart', async () => {
  let f = await fixture(); await f.host.accept(f.job, f.valid)
  let restored = f.create()
  expect((await restored.accept(f.job, f.valid)).status).toBe('interrupted')
  expect(f.handle.start).toHaveBeenCalledTimes(1)
})
it('keeps a busy job retryable without recording a start', async () => {
  let f = await fixture(); f.acquire.mockImplementationOnce(() => { throw new Error('CONTROL_HELD') })
  await expect(f.host.accept(f.job, f.valid)).rejects.toThrow('CONTROL_HELD')
  expect(await f.host.receipts()).toEqual([])
  await f.host.accept(f.job, f.valid); expect(f.handle.start).toHaveBeenCalledTimes(1)
})
it('rejects changed inputs for an existing job ID', async () => {
  let f = await fixture(); await f.host.accept(f.job, f.valid)
  await expect(f.host.accept({ ...f.job, inputs: { text: 'Changed' } }, f.valid)).rejects.toThrow('ACCOUNT_JOB_CHANGED')
  expect(f.handle.start).toHaveBeenCalledTimes(1)
})
it('persists cancellation when delivery was lost before a job started', async () => {
  let f = await fixture()
  expect((await f.host.cancel(f.job.id)).status).toBe('cancelled')
  expect((await f.create().accept(f.job, f.valid)).status).toBe('cancelled')
  expect(f.handle.start).not.toHaveBeenCalled()
})
it('cancels the plugin and releases control on disconnect', async () => {
  vi.useFakeTimers()
  let f = await fixture(); await f.host.accept(f.job, f.valid)
  f.disconnect(); expect(f.guard).toThrow('ACCOUNT_EXECUTION_EXPIRED')
  await vi.advanceTimersByTimeAsync(1001)
  expect((await f.host.receipts())[0].status).toBe('interrupted')
  expect(f.handle.cancel).toHaveBeenCalledOnce(); expect(f.handle.release).toHaveBeenCalledOnce()
})
it('stops on deadline or explicit cancellation and refuses expired new work', async () => {
  let f = await fixture()
  await expect(f.host.accept({ ...f.job, deadline: Date.now() - 1 }, f.valid)).rejects.toThrow('ACCOUNT_JOB_EXPIRED')
  await f.host.accept(f.job, f.valid)
  expect((await f.host.cancel(f.job.id))?.status).toBe('cancelled')
  expect(f.guard).toThrow('ACCOUNT_EXECUTION_EXPIRED')
  expect((await f.host.accept(f.job, f.valid)).status).toBe('cancelled')
})
it('stops a running plugin at the fixed deadline without replaying it', async () => {
  vi.useFakeTimers()
  let f = await fixture(); await f.host.accept(f.job, f.valid)
  await vi.advanceTimersByTimeAsync(60001)
  expect((await f.host.receipts())[0]).toMatchObject({ status: 'interrupted', error: 'EXECUTION_DEADLINE' })
  expect(f.handle.cancel).toHaveBeenCalledOnce()
  expect((await f.host.accept(f.job, f.valid)).status).toBe('interrupted')
  expect(f.handle.start).toHaveBeenCalledOnce()
})
