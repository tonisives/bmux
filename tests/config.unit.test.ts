import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createConfig, defaultConfigText, parseConfig } from '../src/main/config'
import { matchesBinding } from '../src/shared/keyboard'

it('loads macOS defaults, remaps shortcuts and validates YAML', () => {
  let defaultConfig = parseConfig(defaultConfigText())
  let defaults = defaultConfig.keyboard
  expect(defaultConfig.statusBar).toBe('top')
  expect(defaults.shortcuts['Cmd+R']).toBe('reload')
  let custom = parseConfig('keyboard:\n  prefix: Ctrl+A\n  shortcuts:\n    cmd+r: hard-reload\n    Cmd+T: null\n  prefixBindings:\n    c: sessions\n').keyboard
  expect(custom.prefix).toBe('Ctrl+A')
  expect(custom.shortcuts['Cmd+R']).toBeUndefined()
  expect(custom.shortcuts['cmd+r']).toBe('hard-reload')
  expect(custom.shortcuts['Cmd+T']).toBeUndefined()
  expect(custom.prefixBindings.c).toBe('sessions')
  expect(matchesBinding('Cmd+Shift+[', { key: '{', code: 'BracketLeft', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+Shift+\\', { key: '|', code: 'Backslash', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+R', { key: 'r', meta: true, shift: true })).toBe(false)
  expect(() => parseConfig('keyboard:\n  shortcuts: [')).toThrow('Invalid YAML')
  expect(() => parseConfig('keyboard:\n  shortcuts:\n    Cmd+R: typo')).toThrow('Unknown keyboard action')
  expect(() => parseConfig('keyboard:\n  prefixTimeoutMs: 0')).toThrow('prefixTimeoutMs')
  expect(parseConfig('statusBar: bottom\nkeyboard: {}\n').statusBar).toBe('bottom')
  expect(() => parseConfig('statusBar: left\nkeyboard: {}\n')).toThrow('statusBar must be top or bottom')
})
it('preserves existing files and the last valid configuration when an edit is invalid', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browmux-config-'))
  let file = path.join(directory, 'config.yaml')
  fs.writeFileSync(file, '# keep comment\nkeyboard:\n  prefix: Ctrl+A\n')
  let config = createConfig(file, () => undefined)
  try {
    expect(config.keyboard.prefix).toBe('Ctrl+A')
    config.setPrefix('Ctrl+X')
    expect(fs.readFileSync(file, 'utf8')).toContain('# keep comment')
    expect(config.keyboard.prefix).toBe('Ctrl+X')
    fs.writeFileSync(file, 'keyboard: [invalid')
    config.reload()
    expect(config.error).toBeTruthy()
    expect(config.keyboard.prefix).toBe('Ctrl+X')
    expect(() => config.setPrefix('Ctrl+B')).toThrow('Fix invalid YAML')
  } finally { config.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

it('validates accessibility preferences and keeps settings atomic on invalid edits', () => {
  expect(parseConfig('accessibility: true\nkeyboard: {}\n').accessibility).toBe(true)
  expect(parseConfig('keyboard: {}\n').accessibility).toBe(false)
  expect(() => parseConfig('accessibility: yes\nkeyboard: {}\n')).toThrow('accessibility must be true or false')
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'browmux-accessibility-'))
  let file = path.join(directory, 'config.yaml')
  fs.writeFileSync(file, 'accessibility: true\nkeyboard:\n  prefix: Ctrl+2\n')
  let config = createConfig(file, () => undefined)
  try {
    fs.writeFileSync(file, 'accessibility: invalid\nkeyboard:\n  prefix: Ctrl+X\n')
    config.reload()
    expect(config.error).toBeTruthy()
    expect(config.accessibility).toBe(true)
    expect(config.keyboard.prefix).toBe('Ctrl+2')
  } finally { config.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})
