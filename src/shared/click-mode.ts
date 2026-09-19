export type DoubleTapModifier = 'Option' | 'Command' | 'Control' | 'Shift' | 'Escape' | null
export type ClickAction = 'normal' | 'right' | 'command' | 'double'
export type ClickModeSettings = {
  enabled: boolean
  doubleTapModifier: DoubleTapModifier
  hintCharacters: string
  showInput: boolean
  fontSize: number
  opacity: number
  backgroundColor: string
  textColor: string
}

export const DEFAULT_CLICK_MODE: ClickModeSettings = {
  enabled: true,
  doubleTapModifier: 'Option',
  hintCharacters: 'asfghjklqwetyuiopzxvbm',
  showInput: true,
  fontSize: 12,
  opacity: .95,
  backgroundColor: '#ffcc00',
  textColor: '#000000',
}

export let generateHints = (count: number, characters: string) => {
  if (!count) return []
  let alphabet = [...characters.toUpperCase()]
  let length = 1
  while (alphabet.length ** length < count) length++
  return Array.from({ length: count }, (_, number) => {
    let value = number, hint = ''
    for (let position = 0; position < length; position++) { hint = alphabet[value % alphabet.length] + hint; value = Math.floor(value / alphabet.length) }
    return hint.padStart(length, alphabet[0])
  })
}

export type DoubleTapInput = { type: string; key: string; code: string; alt: boolean; control: boolean; meta: boolean; shift: boolean; isAutoRepeat?: boolean }

export let createDoubleTapTracker = (maximumHoldMs = 200, maximumIntervalMs = 300) => {
  let pressedAt = 0, releasedAt = 0, taps = 0, active = false
  let reset = () => { pressedAt = 0; releasedAt = 0; taps = 0; active = false }
  let update = (input: DoubleTapInput, modifier: DoubleTapModifier, now = Date.now()) => {
    if (!modifier) { reset(); return false }
    let keys: Record<Exclude<DoubleTapModifier, null>, { key: string; flag: keyof Pick<DoubleTapInput, 'alt' | 'control' | 'meta' | 'shift'> }> = {
      Option: { key: 'Alt', flag: 'alt' }, Command: { key: 'Meta', flag: 'meta' }, Control: { key: 'Control', flag: 'control' }, Shift: { key: 'Shift', flag: 'shift' }, Escape: { key: 'Escape', flag: 'shift' },
    }
    let expected = keys[modifier]
    let modifierCount = [input.alt, input.control, input.meta, input.shift].filter(Boolean).length
    let target = input.key === expected.key || (modifier === 'Option' && input.code.startsWith('Alt')) || (modifier === 'Command' && input.code.startsWith('Meta')) || (modifier === 'Control' && input.code.startsWith('Control')) || (modifier === 'Shift' && input.code.startsWith('Shift'))
    let invalidModifiers = modifier !== 'Escape' && (input.type === 'keyDown' ? modifierCount !== 1 || !input[expected.flag] : modifierCount > 1 || modifierCount === 1 && !input[expected.flag])
    if (!target || input.isAutoRepeat || invalidModifiers) { if (input.type === 'keyDown') reset(); return false }
    if (input.type === 'keyDown') {
      if (releasedAt && now - releasedAt > maximumIntervalMs) taps = 0
      pressedAt = now; active = true
      return false
    }
    if (input.type !== 'keyUp' || !active || now - pressedAt > maximumHoldMs) { reset(); return false }
    active = false; releasedAt = now; taps++
    if (taps < 2) return false
    reset(); return true
  }
  return { update, reset }
}
