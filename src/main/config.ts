import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseDocument, stringify } from 'yaml'
import { DEFAULT_KEYBOARD, KEY_ACTIONS, parseBinding } from '../shared/keyboard'
import type { KeyboardConfig } from '../shared/keyboard'

export let configPath = (dataDirectory: string) => {
  let configured = process.env.BMUX_CONFIG ?? process.env.BROWMUX_CONFIG
  if (configured) return configured
  if (process.env.BMUX_DATA_DIR ?? process.env.BROWMUX_DATA_DIR) return path.join(dataDirectory, 'config.yaml')
  let root = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  let current = path.join(root, 'bmux', 'config.yaml')
  let legacy = path.join(root, 'browmux', 'config.yaml')
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    fs.mkdirSync(path.dirname(current), { recursive: true })
    fs.renameSync(legacy, current)
  }
  return current
}
export let defaultConfigText = (prefix = DEFAULT_KEYBOARD.prefix) => '# bmux keyboard settings. Changes reload automatically.\n# Set a shortcut or prefix binding to null to disable it.\n# Cmd+C/V/X/A/Z and other standard editing keys use the native Edit menu.\n' + stringify({ accessibility: false, keyboard: { ...DEFAULT_KEYBOARD, prefix } })
export let parseConfig = (text: string): { keyboard: KeyboardConfig; accessibility: boolean } => {
  let document = parseDocument(text)
  if (document.errors.length) throw new Error('Invalid YAML in keyboard configuration')
  let value = document.toJS({ maxAliasCount: 30 })
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.keyboard || typeof value.keyboard !== 'object' || Array.isArray(value.keyboard)) throw new Error('Configuration must contain a keyboard mapping')
  if (value.accessibility !== undefined && typeof value.accessibility !== 'boolean') throw new Error('accessibility must be true or false')
  let keyboard = value.keyboard
  for (let key of Object.keys(keyboard)) if (!['prefix', 'prefixTimeoutMs', 'shortcuts', 'prefixBindings'].includes(key)) throw new Error(`Unknown keyboard setting: ${key}`)
  let result = structuredClone(DEFAULT_KEYBOARD)
  if (keyboard.prefix !== undefined) {
    if (typeof keyboard.prefix !== 'string') throw new Error('keyboard.prefix must be a key combination')
    parseBinding(keyboard.prefix); result.prefix = keyboard.prefix
  }
  if (keyboard.prefixTimeoutMs !== undefined) {
    if (!Number.isInteger(keyboard.prefixTimeoutMs) || keyboard.prefixTimeoutMs < 250 || keyboard.prefixTimeoutMs > 10000) throw new Error('prefixTimeoutMs must be between 250 and 10000')
    result.prefixTimeoutMs = keyboard.prefixTimeoutMs
  }
  for (let field of ['shortcuts', 'prefixBindings'] as const) {
    let bindings = keyboard[field]
    if (bindings === undefined) continue
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw new Error(`${field} must be a mapping`)
    for (let [key, action] of Object.entries(bindings)) {
      if (field === 'shortcuts') {
        let canonical = JSON.stringify(parseBinding(key))
        for (let prior of Object.keys(result.shortcuts)) if (JSON.stringify(parseBinding(prior)) === canonical) delete result.shortcuts[prior]
      }
      else if (key.length !== 1) throw new Error('Prefix bindings must be single characters')
      if (action === null) delete result[field][key]
      else if (typeof action !== 'string' || !KEY_ACTIONS.has(action)) throw new Error(`Unknown keyboard action for ${key}`)
      else result[field][key] = action
    }
  }
  return { keyboard: result, accessibility: value.accessibility ?? false }
}
export let createConfig = (file: string, onChange: () => void, initialPrefix?: string) => {
  let settings = { keyboard: structuredClone(DEFAULT_KEYBOARD), accessibility: false }, error: string | null = null
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try { fs.writeFileSync(file, defaultConfigText(initialPrefix), { flag: 'wx', mode: 0o600 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  let reload = () => {
    try { settings = parseConfig(fs.readFileSync(file, 'utf8')); error = null } catch (failure) { error = failure instanceof Error ? failure.message : 'Could not read keyboard configuration' }
    onChange()
  }
  reload()
  fs.watchFile(file, { interval: 500, persistent: false }, reload)
  return {
    get keyboard() { return settings.keyboard }, get accessibility() { return settings.accessibility }, get error() { return error }, path: file, reload,
    setPrefix: (prefix: string) => {
      parseBinding(prefix)
      let document = parseDocument(fs.readFileSync(file, 'utf8'))
      if (document.errors.length) throw new Error('Fix invalid YAML before changing the prefix')
      document.setIn(['keyboard', 'prefix'], prefix)
      let temporary = `${file}.tmp`
      fs.writeFileSync(temporary, document.toString(), { mode: 0o600 }); fs.renameSync(temporary, file); reload()
    },
    close: () => fs.unwatchFile(file, reload),
  }
}
