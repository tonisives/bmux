import fs from 'node:fs'
import path from 'node:path'
import { initialModel, validateModel } from './model'
import type { Model } from '../shared/types'

export let readModel = (directory: string): Model => {
  let file = path.join(directory, 'state.json')
  if (!fs.existsSync(file)) return initialModel()
  // Never overwrite an unreadable state with an empty session.
  return validateModel(JSON.parse(fs.readFileSync(file, 'utf8')))
}
export let writeModel = (directory: string, model: Model) => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  let file = path.join(directory, 'state.json')
  let temporary = `${file}.tmp`
  let fd = fs.openSync(temporary, 'w', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(model, null, 2))
    fs.fsyncSync(fd)
  } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
}
