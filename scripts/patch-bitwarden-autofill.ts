import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { patchBitwardenConditionalAutofill } from '../src/main/bitwarden-extension'

let location = process.argv[2]
if (!location) throw new Error('Pass the managed Bitwarden extension directory')
location = await fs.realpath(location)
if (path.basename(path.dirname(location)) !== 'extension-packages' || !/^bitwarden(?:-|$)/.test(path.basename(location))) throw new Error('Expected a managed Bitwarden extension package')
let manifest = JSON.parse(await fs.readFile(path.join(location, 'manifest.json'), 'utf8'))
if (manifest.name !== '__MSG_extName__' || !['2026.6.1', '2026.10.0'].includes(manifest.version)) throw new Error('Expected a supported Bitwarden release')
let file = path.join(location, 'content', 'fido2-page-script.js')
let source = await fs.readFile(file, 'utf8')
let patched = patchBitwardenConditionalAutofill(source)
if (patched !== source) {
  await fs.copyFile(file, file + '.before-bmux-conditional-native-probe', constants.COPYFILE_EXCL)
  await fs.writeFile(file, patched)
}
console.log(patched === source ? 'Conditional autofill fix is already installed.' : 'Installed conditional autofill fix; reload the extension to apply it.')
