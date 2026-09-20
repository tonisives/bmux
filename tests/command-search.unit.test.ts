import { test, expect } from 'vitest'
import { commandEntries, COMMANDS, fuzzyMatch, literalCommand, searchCommands } from '../src/shared/command-search'
import { DEFAULT_KEYBOARD } from '../src/shared/keyboard'

test('fuzzy command search matches subsequences and independent terms while preferring command names', () => {
  expect(searchCommands(COMMANDS, 'brtls')[0].command).toBe('browser-tools')
  expect(searchCommands(COMMANDS, 'tracker blocking').map(entry => entry.command)).toContain('adblock on')
  expect(searchCommands(COMMANDS, 'blocking tracker').map(entry => entry.command)).toContain('adblock on')
  expect(COMMANDS.some(entry => entry.command.trim() === 'tabs')).toBe(false)
  expect(searchCommands(COMMANDS, 'dark mode')[0].command).toBe('dark')
  expect(searchCommands(COMMANDS, 'zzzzunmatched')).toEqual([])
  expect(fuzzyMatch('[', 'Cmd+[')?.positions).toEqual([4])
  expect(fuzzyMatch('BrTlS', 'browser-tools')).not.toBeNull()
})

test('finder includes active shortcuts, enabled plugin actions, and deduplicated recent commands', () => {
  let keyboard = structuredClone(DEFAULT_KEYBOARD)
  keyboard.prefix = 'Ctrl+X'; keyboard.shortcuts['Cmd+Alt+D'] = 'browser-tools'
  let entries = commandEntries(keyboard, [
    { id: 'on', name: 'Fixture', version: '1', enabled: true, hooks: false, actions: [{ id: 'title', title: 'Read page heading' }], proxyProviders: [] },
    { id: 'off', name: 'Disabled', version: '1', enabled: false, hooks: false, actions: [{ id: 'title', title: 'Hidden action' }], proxyProviders: [] },
  ])
  expect(entries.find(entry => entry.command === 'browser-tools')?.shortcuts).toContain('Cmd+Alt+D')
  expect(entries.find(entry => entry.command === 'bookmark')?.shortcuts).toContain('Cmd+D')
  expect(entries.find(entry => entry.command === 'reopen-closed-tab')?.shortcuts).toContain('CmdOrCtrl+Shift+T')
  expect(entries.find(entry => entry.command === 'help')?.shortcuts).toContain('Ctrl+X then ?')
  expect(searchCommands(entries, 'page heading')[0].command).toBe('plugin run on/title')
  expect(entries.some(entry => entry.command === 'plugin run off/title')).toBe(false)
  let results = searchCommands(entries, '', ['profiles', 'browser-tools', 'profiles'])
  expect(results.slice(0, 2).map(entry => entry.command)).toEqual(['profiles', 'browser-tools'])
  expect(results.filter(entry => entry.command === 'profiles')).toHaveLength(1)
})

test('typed command arguments and URL navigation remain literal', () => {
  for (let value of ['new-window -n "two words"', 'open https://example.test/path', 'dark off --scope profile', 'https://example.test/', 'example.test', 'split --profile bot']) expect(literalCommand(value)).toBe(true)
  for (let value of ['brtls', 'browser tools', 'dark mode', 'tracker blocking', 'zzzzunmatched']) expect(literalCommand(value)).toBe(false)
})

test('command search describes conditional shortcut contexts', () => {
  let keyboard = structuredClone(DEFAULT_KEYBOARD)
  keyboard.shortcuts['Cmd+Z'] = { action: 'toggle-pane-zoom', when: 'pane-not-editing' }
  expect(commandEntries(keyboard).find(entry => entry.action === 'toggle-pane-zoom')?.shortcuts).toContain('Cmd+Z (pane, outside text fields)')
})
