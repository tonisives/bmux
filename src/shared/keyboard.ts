export type KeyboardConfig = { prefix: string; prefixTimeoutMs: number; shortcuts: Record<string, string>; prefixBindings: Record<string, string> }
export let DEFAULT_KEYBOARD: KeyboardConfig = {
  prefix: 'Ctrl+B', prefixTimeoutMs: 1600,
  shortcuts: {
    'Cmd+L': 'address', 'Cmd+R': 'reload', 'Cmd+Shift+R': 'hard-reload',
    'Cmd+T': 'new-window', 'Cmd+W': 'close-window', 'Cmd+Shift+W': 'detach', 'Cmd+N': 'new-client', 'Cmd+Shift+N': 'new-client',
    'Cmd+1': 'select-window-1', 'Cmd+2': 'select-window-2', 'Cmd+3': 'select-window-3',
    'Cmd+4': 'select-window-4', 'Cmd+5': 'select-window-5', 'Cmd+6': 'select-window-6',
    'Cmd+7': 'select-window-7', 'Cmd+8': 'select-window-8', 'Cmd+9': 'select-window-9',
    'Cmd+F': 'find', 'Cmd+Ctrl+Alt+Shift+W': 'sessions', 'Cmd+[': 'back', 'Cmd+]': 'forward',
    'Cmd+Shift+[': 'previous-window', 'Cmd+Shift+]': 'next-window',
    'Ctrl+Tab': 'next-window', 'Ctrl+Shift+Tab': 'previous-window',
    'Cmd+=': 'zoom-in', 'Cmd+Shift+=': 'zoom-in', 'Cmd+-': 'zoom-out', 'Cmd+0': 'zoom-reset',
    'Cmd+Shift+D': 'toggle-dark', 'Cmd+,': 'settings', F1: 'help', Escape: 'stop',
  },
  prefixBindings: { '1': 'select-window-1', '2': 'select-window-2', '3': 'select-window-3', '4': 'select-window-4', '5': 'select-window-5', '6': 'select-window-6', '7': 'select-window-7', '8': 'select-window-8', '9': 'select-window-9', ':': 'command', '?': 'help', c: 'new-window', n: 'next-window', p: 'previous-window', '%': 'split-right', '"': 'split-down', o: 'next-pane', z: 'toggle-pane-zoom', s: 'sessions', d: 'detach', ',': 'rename-window', r: 'rename-window', x: 'close-pane', '&': 'close-window', '$': 'rename-session', '(': 'previous-session', ')': 'next-session' },
}
export let KEY_ACTIONS = new Set(['browser-tools', 'toggle-dark', 'toggle-adblock', 'address', 'command', 'find', 'help', 'sessions', 'tabs', 'bookmarks', 'activity', 'downloads', 'profiles', 'settings', 'reload', 'hard-reload', 'stop', 'new-client', 'new-window', 'close-pane', 'close-window', 'rename-window', 'rename-session', 'previous-session', 'next-session', 'next-window', 'previous-window', ...Array.from({ length: 9 }, (_, index) => `select-window-${index + 1}`), 'next-pane', 'pane-left', 'pane-down', 'pane-up', 'pane-right', 'toggle-pane-zoom', 'split-right', 'split-down', 'detach', 'back', 'forward', 'zoom-in', 'zoom-out', 'zoom-reset'])
type KeyInput = { key: string; code?: string; meta?: boolean; control?: boolean; alt?: boolean; shift?: boolean }
let named: Record<string, string> = { esc: 'escape', return: 'enter', plus: '=', space: ' ' }
export let parseBinding = (binding: string) => {
  let parts = binding.toLowerCase().split('+'), key = parts.pop() ?? ''
  let modifiers = { meta: false, control: false, alt: false, shift: false }
  for (let modifier of parts) {
    if (['cmd', 'command', 'meta', 'cmdorctrl', 'commandorcontrol'].includes(modifier)) modifiers.meta = true
    else if (['ctrl', 'control'].includes(modifier)) modifiers.control = true
    else if (['alt', 'option'].includes(modifier)) modifiers.alt = true
    else if (modifier === 'shift') modifiers.shift = true
    else throw new Error(`Unknown keyboard modifier: ${modifier}`)
  }
  key = named[key] ?? key
  if (!key || (key.length > 1 && !/^(escape|enter|tab|backspace|delete|left|right|up|down|home|end|pageup|pagedown|f(?:[1-9]|1\d|2[0-4]))$/.test(key))) throw new Error(`Invalid key binding: ${binding}`)
  return { ...modifiers, key }
}
export let matchesBinding = (binding: string, input: KeyInput) => {
  let expected = parseBinding(binding)
  let physical: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Backslash: '\\', Equal: '=', Minus: '-', Comma: ',' }
  let key = physical[input.code ?? ''] ?? input.key.toLowerCase().replace(/^arrow/, '')
  return expected.key === key && expected.meta === !!input.meta && expected.control === !!input.control && expected.alt === !!input.alt && expected.shift === !!input.shift
}

// Keep older config files working without exposing superseded tab actions.
export let normalizeKeyAction = (action: string) => ({ 'new-tab': 'new-window', 'close-tab': 'close-window', 'next-tab': 'next-window', 'previous-tab': 'previous-window' } as Record<string, string>)[action] ?? action
