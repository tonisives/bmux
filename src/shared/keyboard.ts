export type KeyboardConfig = { prefix: string; prefixTimeoutMs: number; shortcuts: Record<string, string>; prefixBindings: Record<string, string> }
export let DEFAULT_KEYBOARD: KeyboardConfig = {
  prefix: 'Ctrl+B', prefixTimeoutMs: 1600,
  shortcuts: {
    'Cmd+L': 'address', 'Cmd+R': 'reload', 'Cmd+Shift+R': 'hard-reload',
    'Cmd+T': 'new-tab', 'Cmd+W': 'close-tab', 'Cmd+Shift+W': 'detach', 'Cmd+N': 'new-client', 'Cmd+Shift+N': 'new-client',
    'Cmd+F': 'find', 'Cmd+[': 'back', 'Cmd+]': 'forward',
    'Cmd+Shift+[': 'previous-tab', 'Cmd+Shift+]': 'next-tab',
    'Ctrl+Tab': 'next-tab', 'Ctrl+Shift+Tab': 'previous-tab',
    'Cmd+=': 'zoom-in', 'Cmd+Shift+=': 'zoom-in', 'Cmd+-': 'zoom-out', 'Cmd+0': 'zoom-reset',
    'Cmd+Shift+D': 'toggle-dark', 'Cmd+,': 'settings', F1: 'help', Escape: 'stop',
  },
  prefixBindings: { ':': 'command', '?': 'help', c: 'new-window', n: 'next-window', p: 'previous-window', '%': 'split-right', '"': 'split-down', o: 'next-pane', z: 'toggle-pane-zoom', s: 'sessions', d: 'detach', ',': 'rename-window', r: 'rename-window', x: 'close-pane', '&': 'close-window', '$': 'rename-session', '(': 'previous-session', ')': 'next-session' },
}
export let KEY_ACTIONS = new Set(['browser-tools', 'toggle-dark', 'toggle-adblock', 'address', 'command', 'find', 'help', 'sessions', 'tabs', 'bookmarks', 'activity', 'profiles', 'settings', 'reload', 'hard-reload', 'stop', 'new-tab', 'close-tab', 'new-client', 'new-window', 'close-pane', 'close-window', 'rename-window', 'rename-session', 'previous-session', 'next-session', 'next-window', 'previous-window', 'next-pane', 'pane-left', 'pane-down', 'pane-up', 'pane-right', 'toggle-pane-zoom', 'split-right', 'split-down', 'detach', 'back', 'forward', 'next-tab', 'previous-tab', 'zoom-in', 'zoom-out', 'zoom-reset'])
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
