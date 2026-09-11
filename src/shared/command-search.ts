import type { KeyboardConfig } from './keyboard'
import type { PluginInfo } from './plugins'

export let PANEL_COMMANDS = ['browser-tools', 'help', 'settings', 'plugins', 'sessions', 'tabs', 'bookmarks', 'activity', 'profiles'] as const
export type CommandEntry = { command: string; description: string; usage?: string; action?: string; complete?: boolean; control?: 'rename-window' | 'rename-session' | 'close-window'; shortcuts?: string[] }

export let COMMANDS: CommandEntry[] = [
  { command: 'browser-tools', description: 'Ad blocking, Dark Reader, userscripts, and saved forms', action: 'browser-tools' },
  { command: 'help', description: 'Search commands and current keyboard shortcuts', action: 'help' },
  { command: 'settings', description: 'Browser settings and keyboard configuration', action: 'settings' },
  { command: 'plugins', description: 'Enable plugins and run plugin actions', action: 'plugins' },
  { command: 'sessions', description: 'Choose a persistent browser session', action: 'sessions' },
  { command: 'tabs', description: 'Choose a tab in this pane', action: 'tabs' },
  { command: 'bookmarks', description: 'Browse bookmarks in this profile', action: 'bookmarks' },
  { command: 'activity', description: 'Downloads, permissions, and running plugins', action: 'activity' },
  { command: 'profiles', description: 'List isolated browser profiles', action: 'profiles' },
  { command: 'open ', usage: 'open URL', description: 'Open a URL or search in the current tab', complete: true, action: 'address' },
  { command: 'dark', usage: 'dark [on|off|system|inherit] [--scope site|profile|global]', description: 'Toggle dark mode for this site', action: 'toggle-dark' },
  { command: 'dark on', description: 'Enable Dark Reader for this site' },
  { command: 'dark off', description: 'Disable website recoloring for this site' },
  { command: 'dark system', description: 'Follow the system color scheme' },
  { command: 'dark inherit', description: 'Remove this site’s dark mode override' },
  { command: 'adblock', usage: 'adblock [on|off|inherit] [--scope site|profile|global]', description: 'Toggle ad and tracker blocking for this site', action: 'toggle-adblock' },
  { command: 'adblock on', description: 'Enable ad and tracker blocking for this site' },
  { command: 'adblock off', description: 'Disable ad and tracker blocking for this site' },
  { command: 'adblock inherit', description: 'Remove this site’s blocking override' },
  { command: 'update-filters', description: 'Download updated ad blocking filter lists' },
  { command: 'reload-scripts', description: 'Reload local userscripts and styles' },
  { command: 'save-fill', description: 'Save visible form fields in encrypted storage' },
  { command: 'fill', description: 'Choose and fill a saved form for this site' },
  { command: 'passwords', description: 'Choose a Bitwarden login using the bw CLI' },
  { command: 'passwords lock', description: 'Lock Bitwarden in bmux and cancel pending fills' },
  { command: 'passwords cancel', description: 'Cancel the pending password fill in this tab' },
  { command: 'new-window', usage: 'new-window [-n NAME]', description: 'Create a window in the current session', action: 'new-window' },
  { command: 'rename-window', usage: 'rename-window -n NAME', description: 'Rename the current window', action: 'rename-window', control: 'rename-window' },
  { command: 'close-window', description: 'Confirm closing the current window', action: 'close-window', control: 'close-window' },
  { command: 'next-window', description: 'Switch to the next window', action: 'next-window' },
  { command: 'previous-window', description: 'Switch to the previous window', action: 'previous-window' },
  { command: 'select-window -t ', usage: 'select-window -t INDEX', description: 'Switch to a window by index or ID', complete: true },
  { command: 'new-session -s ', usage: 'new-session -s NAME [--profile PROFILE]', description: 'Create a persistent session', complete: true },
  { command: 'session ', usage: 'session NAME', description: 'Switch this client to a session', complete: true },
  { command: 'rename-session', usage: 'rename-session -n NAME', description: 'Rename the current session', action: 'rename-session', control: 'rename-session' },
  { command: 'next-session', description: 'Switch to the next session', action: 'next-session' },
  { command: 'previous-session', description: 'Switch to the previous session', action: 'previous-session' },
  { command: 'new-client', description: 'Open another native browser client', action: 'new-client' },
  { command: 'detach', description: 'Close this client and keep its session running', action: 'detach' },
  { command: 'split-window -h', usage: 'split-window -h [--profile PROFILE]', description: 'Split the pane side by side', action: 'split-right' },
  { command: 'split-window -v', usage: 'split-window -v [--profile PROFILE]', description: 'Split the pane above and below', action: 'split-down' },
  { command: 'next-pane', description: 'Select the next pane', action: 'next-pane' },
  { command: 'toggle-pane-zoom', description: 'Expand or restore the selected pane', action: 'toggle-pane-zoom' },
  ...['left', 'down', 'up', 'right'].map(direction => ({ command: `pane-${direction}`, description: `Select the pane to the ${direction}`, action: `pane-${direction}` })),
  { command: 'select-pane -t ', usage: 'select-pane -t PANE_ID', description: 'Select a pane by ID', complete: true },
  { command: 'move-pane --window ', usage: 'move-pane --window WINDOW_ID', description: 'Move this pane into another window', complete: true },
  { command: 'kill-pane ', usage: 'kill-pane --confirm', description: 'Close the selected pane after explicit confirmation', complete: true },
  { command: 'tab new', usage: 'tab new [URL]', description: 'Create a tab in this pane', action: 'new-tab' },
  { command: 'tab close', description: 'Close the selected tab', action: 'close-tab' },
  { command: 'tab select -t ', usage: 'tab select -t INDEX', description: 'Select a tab by index or ID', complete: true },
  { command: 'next-tab', description: 'Select the next tab', action: 'next-tab' },
  { command: 'previous-tab', description: 'Select the previous tab', action: 'previous-tab' },
  ...['back', 'forward', 'reload', 'hard-reload', 'stop'].map(command => ({ command, description: ({ back: 'Go back in page history', forward: 'Go forward in page history', reload: 'Reload the page', 'hard-reload': 'Reload without cached resources', stop: 'Stop loading this page' })[command]!, action: command })),
  { command: 'devtools', description: 'Open Chromium developer tools for this tab' },
  { command: 'zoom ', usage: 'zoom PERCENT', description: 'Set the page zoom percentage', complete: true },
  { command: 'save-layout ', usage: 'save-layout NAME', description: 'Save the current pane layout', complete: true },
  { command: 'restore-layout ', usage: 'restore-layout NAME --confirm', description: 'Restore a saved pane layout', complete: true },
  { command: 'profile create ', usage: 'profile create NAME [--background]', description: 'Create an isolated browser profile', complete: true },
  { command: 'profile rename ', usage: 'profile rename OLD NEW', description: 'Rename a browser profile', complete: true },
  { command: 'plugin list', description: 'List installed local plugins' },
  { command: 'plugin run ', usage: 'plugin run ID/ACTION', description: 'Run a local plugin action', complete: true },
  { command: 'plugin runs', description: 'List plugin runs' },
  { command: 'plugin cancel ', usage: 'plugin cancel RUN_ID', description: 'Cancel a running plugin', complete: true },
  { command: 'plugin reload', description: 'Rescan local plugin manifests' },
  { command: 'import-brave', description: 'Import Brave profiles and bookmark folders' },
  { command: 'edit-config', description: 'Open the YAML configuration file' },
  { command: 'reload-config', description: 'Reload settings from the configuration file' },
  { command: 'prefix ', usage: 'prefix LETTER', description: 'Change the tmux-style keyboard prefix', complete: true },
  { command: 'quit', description: 'Quit the browser and its background sessions' },
]

export let commandEntries = (keyboard: KeyboardConfig, plugins: PluginInfo[] = []): CommandEntry[] => {
  let bindings = [...Object.entries(keyboard.shortcuts), ...Object.entries(keyboard.prefixBindings).map(([key, action]) => [`${keyboard.prefix} then ${key}`, action])]
  let entries = [...COMMANDS, ...plugins.filter(plugin => plugin.enabled).flatMap(plugin => plugin.actions.map(action => ({ command: `plugin run ${plugin.id}/${action.id}`, description: `${plugin.name}: ${action.title}${action.description ? ` — ${action.description}` : ''}`, action: `plugin:${plugin.id}/${action.id}` })))]
  return entries.map(entry => ({ ...entry, shortcuts: bindings.filter(([, action]) => entry.action && action === entry.action).map(([key]) => key) }))
}

// Case-insensitive subsequences, with bonuses for contiguous letters and word starts.
// Whitespace separates terms; every term must match, in any order.
export let fuzzyMatch = (query: string, value: string): { score: number; positions: number[] } | null => {
  let text = value.toLowerCase(), positions = new Set<number>(), score = 0
  for (let term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    let cursor = 0, previous = -2
    for (let letter of term) {
      let index = text.indexOf(letter, cursor)
      if (index < 0) return null
      score += 10 + (index === previous + 1 ? 12 : 0) + (index === 0 || /[\s\-_/]/.test(text[index - 1]) ? 16 : 0) - (index - cursor) * 0.5
      positions.add(index); cursor = index + 1; previous = index
    }
    if (text === term) score += 100
  }
  return { score: score - value.length * 0.01, positions: [...positions].sort((a, b) => a - b) }
}

export let searchCommands = (entries: CommandEntry[], query: string, history: string[] = []) => {
  let unique = new Map(entries.map(entry => [entry.command.trim(), entry]))
  let recent = [...new Set(history.slice().reverse())].map(command => ({ ...unique.get(command.trim()), command, description: 'Recent command' }))
  let candidates = [...recent, ...entries.filter(entry => !recent.some(item => item.command.trim() === entry.command.trim()))]
  if (!query.trim()) return candidates
  return candidates.map(entry => {
    let match = fuzzyMatch(query, `${entry.command} ${entry.description} ${entry.shortcuts?.join(' ') ?? ''}`)
    let usage = fuzzyMatch(query, entry.usage ?? '')
    let name = fuzzyMatch(query, entry.command.trim())
    return { entry, score: name ? name.score + 150 : Math.max(match?.score ?? -Infinity, usage ? usage.score - 20 : -Infinity) }
  }).filter(item => item.score !== -Infinity).sort((a, b) => b.score - a.score).map(item => item.entry)
}

let commandNames = new Set([...COMMANDS.map(entry => entry.command.trim().split(' ')[0]), 'navigate', 'split', 'switch-client', 'attach-session', 'detach-client', 'kill-window'])
export let literalCommand = (line: string) => {
  let [name, argument] = line.trim().replace(/^:/, '').split(/\s+/)
  let choices: Record<string, string[]> = { dark: ['on', 'off', 'system', 'inherit'], adblock: ['on', 'off', 'inherit'], tab: ['new', 'close', 'select'], profile: ['create', 'rename'], plugin: ['list', 'run', 'runs', 'cancel', 'reload'] }
  if (choices[name] && argument && !argument.startsWith('-') && !choices[name].includes(argument)) return false
  return commandNames.has(name) || /^(https?:\/\/|localhost[:/])/.test(name) || name.includes('.')
}

export let HELP_NOTES = [
  'Commands use the current session, window, pane, and tab unless you provide a target. Quote names containing spaces. Window and tab indices start at 0.',
  'In the command finder: type to fuzzy search, Up/Down or Ctrl+P/N selects, Tab completes, and Enter opens or runs. Ctrl+R/S recalls command history. Shift+Enter runs the typed command exactly.',
  'In the session picker: Up/Down moves, Home/End jumps, PageUp/PageDown scrolls, Enter attaches, and Escape cancels.',
  'In the tab picker: the active tab starts focused. Up/Down moves, Home/End jumps, PageUp/PageDown moves ten rows, Enter selects, and Escape cancels without switching tabs.',
  'Closing an internal window asks for y/n. Closing a native client leaves its session running.',
  'Drag the blank area of the status bar to move this macOS window.',
]
