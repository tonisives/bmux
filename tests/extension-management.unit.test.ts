import { afterEach, expect, it, vi } from 'vitest'
import type { Extension, Session } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createExtensions } from '../src/main/extensions'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/extension-compatibility', () => ({ createExtensionCompatibility: () => ({ track: vi.fn() }) }))
let directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.map(directory => fs.rm(directory, { recursive: true, force: true }))); directories = [] })
let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-extension-management-'))
  directories.push(directory)
  let location = path.join(directory, 'fixture')
  await fs.mkdir(location)
  await fs.writeFile(path.join(location, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Fixture extension', version: '1.0' }))
  return { directory, location: await fs.realpath(location) }
}
let session = () => {
  let loaded = new Map<string, Extension>()
  let extensions = {
    loadExtension: vi.fn(async (location: string) => {
      let manifest = JSON.parse(await fs.readFile(path.join(location, 'manifest.json'), 'utf8'))
      let extension = { id: 'fixture-id', path: location, name: manifest.name, version: manifest.version, manifest } as Extension
      loaded.set(extension.id, extension)
      return extension
    }),
    getExtension: (id: string) => loaded.get(id),
    getAllExtensions: () => [...loaded.values()],
    removeExtension: vi.fn((id: string) => { loaded.delete(id) })
  }
  return { extensions } as unknown as Session
}

it('persists disabled state, preserves profile isolation, and re-enables by name after restart', async () => {
  let { directory, location } = await fixture()
  let manager = createExtensions(directory, () => ({})), first = session(), second = session()
  await manager.attach('first', first); await manager.attach('second', second)
  await manager.load('first', location); await manager.load('second', location)
  await manager.disable('first', 'Fixture')
  expect(first.extensions.getAllExtensions()).toEqual([])
  expect(second.extensions.getAllExtensions()).toHaveLength(1)
  manager = createExtensions(directory, () => ({})); first = session()
  await manager.attach('first', first)
  expect(first.extensions.loadExtension).not.toHaveBeenCalled()
  expect((await manager.list('first')).extensions).toMatchObject([{ id: 'fixture-id', name: 'Fixture extension', enabled: false }])
  await manager.enable('first', 'Fixture')
  expect(first.extensions.getAllExtensions()).toHaveLength(1)
  await manager.disable('first', 'fixture-id')
  await manager.remove('first', 'fixture-id')
  expect((await manager.list('first')).extensions).toEqual([])
  expect(JSON.parse(await fs.readFile(path.join(directory, 'extensions.json'), 'utf8'))).toMatchObject([{ profile: 'second', enabled: true }])
  await expect(fs.access(location)).resolves.toBeUndefined()
})

it('restores old registries and removes a failed installation without matching an unrelated entry', async () => {
  let { directory, location } = await fixture()
  let missing = path.join(directory, 'missing')
  await fs.writeFile(path.join(directory, 'extensions.json'), JSON.stringify([{ profile: 'first', path: location }, { profile: 'first', path: missing }]))
  let manager = createExtensions(directory, () => ({})), first = session()
  await manager.attach('first', first)
  expect(first.extensions.getAllExtensions()).toHaveLength(1)
  expect((await manager.list('first')).errors).toHaveLength(1)
  await expect(manager.remove('first', 'unknown-id')).rejects.toThrow('not installed')
  expect((await manager.list('first')).extensions).toHaveLength(2)
  await manager.remove('first', missing)
  expect((await manager.list('first')).extensions).toMatchObject([{ id: 'fixture-id', enabled: true }])
})

it('rolls back failed writes and failed re-enabling', async () => {
  let { directory, location } = await fixture()
  let manager = createExtensions(directory, () => ({})), first = session()
  await manager.attach('first', first); await manager.load('first', location)
  let fail = () => vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('write failed'))
  fail()
  await expect(manager.disable('first', 'Fixture')).rejects.toThrow('write failed')
  expect(first.extensions.getAllExtensions()).toHaveLength(1)
  expect((await manager.list('first')).extensions[0].enabled).toBe(true)
  fail()
  await expect(manager.remove('first', 'Fixture')).rejects.toThrow('write failed')
  expect((await manager.list('first')).extensions).toHaveLength(1)
  await manager.disable('first', 'Fixture')
  fail()
  await expect(manager.enable('first', 'Fixture')).rejects.toThrow('write failed')
  expect(first.extensions.getAllExtensions()).toEqual([])
  expect((await manager.list('first')).extensions[0].enabled).toBe(false)
  await fs.rm(location, { recursive: true })
  await expect(manager.enable('first', 'Fixture')).rejects.toThrow()
  expect((await manager.list('first')).extensions[0].enabled).toBe(false)
})
