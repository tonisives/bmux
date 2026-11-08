export type ScrollingSettings = { enabled: boolean; randomize: boolean; overshoot: boolean }
export let DEFAULT_SCROLLING: ScrollingSettings = { enabled: true, randomize: true, overshoot: true }

export let parseScrolling = (value: unknown, defaults = DEFAULT_SCROLLING): ScrollingSettings => {
  if (value === undefined) return { ...defaults }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('scrolling must be a mapping')
  let result = { ...defaults }
  for (let [key, flag] of Object.entries(value)) {
    if (!Object.hasOwn(DEFAULT_SCROLLING, key)) throw new Error(`Unknown scrolling setting: ${key}`)
    if (typeof flag !== 'boolean') throw new Error(`scrolling.${key} must be true or false`)
    result[key as keyof ScrollingSettings] = flag
  }
  return result
}
