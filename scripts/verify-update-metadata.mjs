import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'

let [file, version, arch] = process.argv.slice(2)
assert.ok(file && version && ['arm64', 'x64'].includes(arch), 'Expected metadata file, version, and architecture')
let metadata = parse(await fs.readFile(file, 'utf8'))
assert.equal(metadata.version, version)
assert.ok(metadata.files?.some(entry => entry.url === `bmux-${version}-${arch}.zip`), 'Update ZIP is missing')
for (let entry of metadata.files) {
  assert.ok([`bmux-${version}-${arch}.zip`, `bmux-${version}-${arch}.dmg`].includes(entry.url), 'Unexpected update asset')
  let data = await fs.readFile(path.join(path.dirname(file), entry.url))
  assert.equal(entry.size, data.length)
  assert.equal(entry.sha512, createHash('sha512').update(data).digest('base64'))
}
console.log(`Verified update metadata for ${version} ${arch}`)
