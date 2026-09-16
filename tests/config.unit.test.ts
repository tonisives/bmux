import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { configPath, createConfig, defaultConfigText, parseConfig } from '../src/main/config'
import { isModifierKeyBinding, matchesBinding, shortcutMatchesContext } from '../src/shared/keyboard'

it('loads macOS defaults, remaps shortcuts and validates YAML', () => {
  let defaultConfig = parseConfig(defaultConfigText())
  let defaults = defaultConfig.keyboard
  expect(defaultConfig.statusBar).toBe('top')
  expect(defaults.shortcuts['Cmd+R']).toBe('reload')
  expect(defaults.shortcuts['Cmd+Ctrl+Alt+Shift+W']).toBe('sessions')
  expect(defaults.shortcuts['Cmd+T']).toBe('new-window')
  expect(defaults.shortcuts['Cmd+W']).toBe('close-window')
  expect(defaults.shortcuts['CmdOrCtrl+F']).toBe('find')
  expect(defaults.shortcuts['Cmd+1']).toBe('select-window-1')
  expect(defaults.shortcuts['Cmd+9']).toBe('select-window-9')
  expect(defaults.prefixBindings['1']).toBe('select-window-1')
  expect(defaults.prefixBindings['9']).toBe('select-window-9')
  expect(defaults.prefixBindings.z).toBe('toggle-pane-zoom')
  expect(parseConfig('keyboard:\n  prefixBindings:\n    q: close-pane\n').keyboard.prefixBindings.q).toBe('close-pane')
  let custom = parseConfig('keyboard:\n  prefix: Ctrl+A\n  shortcuts:\n    cmd+r: hard-reload\n    Cmd+T: null\n  prefixBindings:\n    c: sessions\n').keyboard
  expect(custom.prefix).toBe('Ctrl+A')
  expect(custom.shortcuts['Cmd+R']).toBeUndefined()
  expect(custom.shortcuts['cmd+r']).toBe('hard-reload')
  expect(custom.shortcuts['Cmd+T']).toBeUndefined()
  expect(custom.prefixBindings.c).toBe('sessions')
  let aliases = parseConfig('keyboard:\n  shortcuts:\n    Cmd+Z: toggle-pane-zoom\n  prefixBindings:\n    z: toggle-pane-zoom\n').keyboard
  expect(aliases.shortcuts['Cmd+Z']).toBe('toggle-pane-zoom')
  expect(aliases.prefixBindings.z).toBe('toggle-pane-zoom')
  expect(matchesBinding('Cmd+Shift+[', { key: '{', code: 'BracketLeft', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+Shift+\\', { key: '|', code: 'Backslash', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+Ctrl+Alt+Shift+W', { key: 'w', meta: true, control: true, alt: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+R', { key: 'r', meta: true, shift: true })).toBe(false)
  expect(isModifierKeyBinding('Cmd+ShiftLeft')).toBe(true)
  expect(matchesBinding('Cmd+ShiftLeft', { key: 'Shift', code: 'ShiftLeft', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('Cmd+ShiftLeft', { key: 'Shift', code: 'ShiftRight', meta: true, shift: true })).toBe(false)
  expect(matchesBinding('Cmd+ShiftRight', { key: 'Shift', code: 'ShiftRight', meta: true, shift: true })).toBe(true)
  expect(matchesBinding('CmdOrCtrl+F', { key: 'f', meta: true }, 'darwin')).toBe(true)
  expect(matchesBinding('CmdOrCtrl+F', { key: 'f', control: true }, 'linux')).toBe(true)
  expect(matchesBinding('CmdOrCtrl+F', { key: 'f', control: true }, 'win32')).toBe(true)
  expect(matchesBinding('CmdOrCtrl+F', { key: 'f', meta: true }, 'linux')).toBe(false)
  expect(() => parseConfig('keyboard:\n  shortcuts: [')).toThrow('Invalid YAML')
  expect(() => parseConfig('keyboard:\n  shortcuts:\n    Cmd+R: typo')).toThrow('Unknown keyboard action')
  expect(() => parseConfig('keyboard:\n  prefixTimeoutMs: 0')).toThrow('prefixTimeoutMs')
  expect(parseConfig('statusBar: bottom\nkeyboard: {}\n').statusBar).toBe('bottom')
  expect(() => parseConfig('statusBar: left\nkeyboard: {}\n')).toThrow('statusBar must be top or bottom')
})
it('preserves existing files and the last valid configuration when an edit is invalid', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-config-'))
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
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-accessibility-'))
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

it('moves the previous config into the bmux config directory', () => {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-config-path-'))
  let previousEnvironment = {
    BMUX_CONFIG: process.env.BMUX_CONFIG,
    BROWMUX_CONFIG: process.env.BROWMUX_CONFIG,
    BMUX_DATA_DIR: process.env.BMUX_DATA_DIR,
    BROWMUX_DATA_DIR: process.env.BROWMUX_DATA_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  }
  delete process.env.BMUX_CONFIG
  delete process.env.BROWMUX_CONFIG
  delete process.env.BMUX_DATA_DIR
  delete process.env.BROWMUX_DATA_DIR
  process.env.XDG_CONFIG_HOME = root
  let legacy = path.join(root, 'browmux', 'config.yaml')
  fs.mkdirSync(path.dirname(legacy), { recursive: true })
  fs.writeFileSync(legacy, 'keyboard:\n  prefix: Ctrl+A\n')
  try {
    let current = configPath(path.join(root, 'data'))
    expect(current).toBe(path.join(root, 'bmux', 'config.yaml'))
    expect(fs.readFileSync(current, 'utf8')).toContain('Ctrl+A')
    expect(fs.existsSync(legacy)).toBe(false)
  } finally {
    for (let [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
})

it('merges legacy tab actions into window actions and overrides history defaults', () => {
  let config = parseConfig('keyboard:\n  shortcuts:\n    "Command+[": previous-window\n    "Cmd+]": next-window\n    "Ctrl+Tab": next-tab\n    "Cmd+T": new-tab\n    "Cmd+W": close-tab\n  prefixBindings:\n    p: previous-tab\n').keyboard
  expect(config.shortcuts['Cmd+[']).toBeUndefined()
  expect(config.shortcuts['Command+[']).toBe('previous-window')
  expect(config.shortcuts['Cmd+]']).toBe('next-window')
  expect(config.shortcuts['Ctrl+Tab']).toBe('next-window')
  expect(config.shortcuts['Cmd+T']).toBe('new-window')
  expect(config.shortcuts['Cmd+W']).toBe('close-window')
  expect(config.prefixBindings.p).toBe('previous-window')
  expect(defaultConfigText()).not.toMatch(/(?:new|close|next|previous)-tab/)
})

it('accepts conditional shortcuts while preserving legacy bindings and validating contexts', () => {
  let config = parseConfig('keyboard:\n  shortcuts:\n    Command+R: { action: new-tab, when: pane-not-editing }\n    Cmd+Z: { action: toggle-pane-zoom }\n    Cmd+T: null\n').keyboard
  expect(config.shortcuts['Cmd+R']).toBeUndefined()
  expect(config.shortcuts['Command+R']).toEqual({ action: 'new-window', when: 'pane-not-editing' })
  expect(config.shortcuts['Cmd+Z']).toEqual({ action: 'toggle-pane-zoom' })
  expect(config.shortcuts['Cmd+T']).toBeUndefined()
  expect(config.shortcuts['Cmd+W']).toBe('close-window')
  for (let binding of ['{ action: reload, when: typo }', '{ action: reload, when: null }', '{ action: typo }', '{ when: always }', '{ action: reload, extra: true }', '[]']) expect(() => parseConfig(`keyboard:\n  shortcuts:\n    Cmd+Z: ${binding}\n`)).toThrow()
  expect(() => parseConfig('keyboard:\n  prefixBindings:\n    z: { action: toggle-pane-zoom, when: pane-not-editing }\n')).toThrow()
  let binding = config.shortcuts['Command+R']
  expect(shortcutMatchesContext(binding, true, false)).toBe(true)
  for (let editing of [true, undefined]) expect(shortcutMatchesContext(binding, true, editing)).toBe(false)
  expect(shortcutMatchesContext(binding, false, false)).toBe(false)
  expect(shortcutMatchesContext('reload', false, undefined)).toBe(true)
  expect(shortcutMatchesContext({ action: 'reload', when: 'always' }, false, true)).toBe(true)
})
