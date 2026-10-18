import path from 'node:path'
import { installBitwardenExtension } from '../src/main/bitwarden-extension'

// Keep preview packages separate from the stable package and its extension ID.
let directory = path.resolve(process.argv[2] ?? '.test-data/bitwarden-preview')
let location = path.join(directory, 'extension-packages', 'bitwarden-2026.10.0')
await installBitwardenExtension(directory, location, '2026.10.0')
console.log(location)
