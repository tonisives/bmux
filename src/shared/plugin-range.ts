import type { PluginParameter } from './plugins'

export let pluginRangeValue = (value: unknown, range: NonNullable<PluginParameter['range']>): [number, number] => {
  let match = typeof value === 'string' && value.match(/^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/)
  if (!match) throw new Error('Expected a number or range')
  let low = Number(match[1]), high = Number(match[2] ?? match[1])
  if (low < range.min || high > range.max || low > high || [low, high].some(item => !Number.isSafeInteger(item) || (item - range.min) % range.step !== 0)) throw new Error('Range is outside slider bounds')
  return [low, high]
}
