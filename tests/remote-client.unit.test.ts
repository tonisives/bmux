import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createLocalRemote } from '../src/main/remote-client'
import { requestRemoteSessionPreviews } from '../src/main/remote-request'
import type { LocalRemoteHost } from '../src/main/remote-client'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, session: { fromPartition: vi.fn(), defaultSession: { cookies: { get: async () => [{ name: 'bmux_session', value: 'fixture' }] } } } }))
vi.mock('../src/main/remote-request', () => ({ requestRemoteSessionPreviews: vi.fn(), requestRemoteSessionClose: vi.fn() }))
let directory: string, hosts: LocalRemoteHost[]
let snapshot = { image: 'data:image/jpeg;base64,Zmlyc3Q=', capturedAt: 123456 }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-local-remote-'))
  hosts = [{ id: 'host', generation: 'generation', key: { x: 'key' }, permission: 'watch', service: 'fixture', sessions: [{ id: 'one', name: 'One', private: false, canPreview: true, panes: [{ id: 'pane-one', title: 'One page' }] }, { id: 'two', name: 'Two', private: false, canPreview: true, panes: [{ id: 'pane-two', title: 'Two page' }] }] }]
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => hosts })))
  vi.mocked(requestRemoteSessionPreviews).mockReset().mockImplementation(async (_origin, _host, _session, panes) => Object.fromEntries(panes.map(pane => [pane, snapshot])))
})
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(directory, { recursive: true, force: true }) })

it('returns local images without fetching and refreshes only missing images by default', async () => {
  let remote = createLocalRemote(directory)
  await remote.list()
  expect(await remote.sessionPreviews('host', 'one', 'cache')).toEqual({})
  expect(requestRemoteSessionPreviews).not.toHaveBeenCalled()
  expect(await remote.sessionPreviews('host', 'one')).toEqual({ 'pane-one': snapshot })
  await remote.sessionPreviews('host', 'one'); await remote.sessionPreviews('host', 'one', 'cache')
  expect(requestRemoteSessionPreviews).toHaveBeenCalledTimes(1)
  await remote.sessionPreviews('host', 'one', 'refresh')
  expect(requestRemoteSessionPreviews).toHaveBeenCalledTimes(2)
  await remote.flush()
  let reopened = createLocalRemote(directory)
  await reopened.refreshPreviewSettings()
  await reopened.list()
  expect(await reopened.sessionPreviews('host', 'one', 'cache')).toEqual({ 'pane-one': snapshot })
})
it('coalesces duplicate requests while fetching every listed session', async () => {
  let remote = createLocalRemote(directory)
  let values = await Promise.all([remote.sessionPreviews('host', 'one'), remote.sessionPreviews('host', 'two'), remote.sessionPreviews('host', 'one')])
  expect(values).toEqual([{ 'pane-one': snapshot }, { 'pane-two': snapshot }, { 'pane-one': snapshot }])
  expect(requestRemoteSessionPreviews).toHaveBeenCalledTimes(2)
  await remote.flush()
})
it('retains a saved image if a refresh fails and rejects a page outside the selected session', async () => {
  let remote = createLocalRemote(directory)
  await remote.sessionPreviews('host', 'one')
  vi.mocked(requestRemoteSessionPreviews).mockRejectedValueOnce(new Error('Offline'))
  expect(await remote.sessionPreviews('host', 'one', 'refresh')).toEqual({ 'pane-one': snapshot })
  await expect(remote.open('host', 'one', async () => {}, 'pane-two')).rejects.toThrow('Remote pane unavailable')
  let page: any
  await remote.open('host', 'one', async value => { page = value }, 'pane-one')
  expect(page.view).toMatchObject({ pane: 'pane-one', panes: [{ id: 'pane-one' }] })
  await remote.flush()
})
