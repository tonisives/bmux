import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { initialModel, validateModel } from '../src/main/model'
import { importBrave } from '../src/main/brave'
import { readModel, writeModel } from '../src/main/store'

let fixture = () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'browmux-brave-'))
  fs.mkdirSync(path.join(root, 'Default'))
  fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'bot' }, 'Profile 1': { name: 'personal' } } } }))
  fs.writeFileSync(path.join(root, 'Default', 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [{ type: 'folder', name: 'Work', children: [{ type: 'url', name: '<Project>', url: 'https://example.test/a?b=1&c=2' }] }] } } }))
  return root
}
describe('Brave import', () => {
  it('preserves folders and profile separation without overwriting a same-name profile; repeat imports are idempotent', () => {
    let root = fixture()
    try {
      let original = initialModel()
      let sourceBefore = fs.readFileSync(path.join(root, 'Default', 'Bookmarks'), 'utf8')
      let result = importBrave(original, root)
      expect(original.profiles).toHaveLength(2)
      expect(result.profiles.map(profile => profile.name)).toEqual(['bot (Brave)', 'personal'])
      let imported = result.model.profiles[2]
      expect(imported.background).toBe(true)
      expect(imported.bookmarks?.[0].children?.[0].children?.[0]).toMatchObject({ title: '<Project>', url: 'https://example.test/a?b=1&c=2' })
      expect(result.model.sessions[1].defaultProfileId).toBe(imported.id)
      expect(result.profiles.map(profile => profile.bookmarks)).toEqual([1, 0])
      let again = importBrave(result.model, root)
      expect(again.model).toEqual(result.model)
      expect(again.profiles.every(profile => !profile.created)).toBe(true)
      expect(fs.readFileSync(path.join(root, 'Default', 'Bookmarks'), 'utf8')).toBe(sourceBefore)
      let destination = path.join(root, 'destination')
      writeModel(destination, result.model)
      expect(readModel(destination)).toEqual(validateModel(result.model))
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  it('aborts invalid bookmark data or directory traversal without changing the model', () => {
    let root = fixture()
    try {
      let model = initialModel()
      let original = structuredClone(model)
      fs.writeFileSync(path.join(root, 'Default', 'Bookmarks'), '{broken')
      expect(() => importBrave(model, root)).toThrow()
      expect(model).toEqual(original)
      fs.writeFileSync(path.join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { '../outside': { name: 'escape' } } } }))
      expect(() => importBrave(model, root)).toThrow('Unsupported Brave profile directory')
      expect(model).toEqual(original)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
})
