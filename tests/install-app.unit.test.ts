import { test, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let { installApp, finishPendingInstall } = await import(pathToFileURL(path.resolve('scripts/install-app.mjs')).href)
let fixture = async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-install-test-'))
  let source = path.join(directory, 'source.app'), output = path.join(directory, 'tools'), destination = path.join(output, 'bmux.app')
  for (let [app, version] of [[source, 'new'], [destination, 'old']]) {
    await fs.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true })
    await fs.writeFile(path.join(app, 'Contents/MacOS/bmux'), version, { mode: 0o755 })
  }
  let read = (app = destination) => fs.readFile(path.join(app, 'Contents/MacOS/bmux'), 'utf8')
  let options = { source, directory: output, copy: (from: string, to: string) => fs.cp(from, to, { recursive: true }), sign: async () => {}, defer: async () => {}, running: async () => false }
  return { directory, destination, output, read, options, cleanup: () => fs.rm(directory, { recursive: true, force: true }) }
}

test('signs the staged copy before replacing the installed app and removes its backup', async () => {
  let current = await fixture()
  try {
    let original = await fs.stat(current.destination)
    let result = await installApp({ ...current.options, sign: async (staged: string) => {
      expect(staged).not.toBe(current.destination)
      expect(await current.read()).toBe('old')
      expect((await fs.stat(current.destination)).ino).toBe(original.ino)
      expect(await current.read(staged)).toBe('new')
    } })
    expect(result.deferred).toBe(false)
    expect(await current.read()).toBe('new')
    expect(await fs.readdir(current.output)).toEqual(['bmux.app'])
  } finally { await current.cleanup() }
})

test('leaves the installed executable untouched if signing or verification fails', async () => {
  let current = await fixture()
  try {
    let original = await fs.stat(current.destination)
    await expect(installApp({ ...current.options, sign: async () => { throw new Error('verification failed') } })).rejects.toThrow('verification failed')
    expect(await current.read()).toBe('old')
    expect((await fs.stat(current.destination)).ino).toBe(original.ino)
    expect(await fs.readdir(current.output)).toEqual(['bmux.app'])
  } finally { await current.cleanup() }
})

test('keeps a running bundle at its original path until the app and its helpers exit', async () => {
  let current = await fixture()
  try {
    let original = await fs.stat(current.destination), alive = true, deferred = false
    let result = await installApp({ ...current.options, running: async () => alive, defer: async () => { deferred = true } })
    expect(result.deferred).toBe(true)
    expect(deferred).toBe(true)
    expect(await current.read()).toBe('old')
    expect((await fs.stat(current.destination)).ino).toBe(original.ino)
    let waits = 0
    expect(await finishPendingInstall(result.temporary, current.destination, { running: async () => alive, wait: async () => {
      expect(await current.read()).toBe('old')
      waits++
      alive = false
    } })).toBe(true)
    expect(waits).toBe(1)
    expect(await current.read()).toBe('new')
    expect(await fs.readdir(current.output)).toEqual(['bmux.app'])
  } finally { await current.cleanup() }
})

test('restores the original bundle if promoting a staged app fails', async () => {
  let current = await fixture()
  try {
    let original = await fs.stat(current.destination)
    await expect(installApp({ ...current.options, sign: async (staged: string) => { await fs.rm(staged, { recursive: true }) } })).rejects.toThrow()
    expect(await current.read()).toBe('old')
    expect((await fs.stat(current.destination)).ino).toBe(original.ino)
    expect(await fs.readdir(current.output)).toEqual(['bmux.app'])
  } finally { await current.cleanup() }
})

test('a newer queued build supersedes an older worker without changing the running app', async () => {
  let current = await fixture()
  try {
    let options = { ...current.options, running: async () => true }
    let older = await installApp(options)
    await fs.writeFile(path.join(current.options.source, 'Contents/MacOS/bmux'), 'newest')
    let newer = await installApp(options)
    expect(await finishPendingInstall(older.temporary, current.destination, { running: async () => false })).toBe(false)
    expect(await current.read()).toBe('old')
    expect(await finishPendingInstall(newer.temporary, current.destination, { running: async () => false })).toBe(true)
    expect(await current.read()).toBe('newest')
    expect(await fs.readdir(current.output)).toEqual(['bmux.app'])
  } finally { await current.cleanup() }
})
