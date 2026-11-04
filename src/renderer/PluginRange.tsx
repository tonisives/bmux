import type { ChangeEvent, CSSProperties } from 'react'
import type { PluginParameter } from '../shared/plugins'
import { pluginRangeValue } from '../shared/plugin-range'
import css from './PluginRange.module.css'

type Props = { field: PluginParameter; value: unknown; onChange: (name: string, value: string) => void }
export let PluginRange = ({ field, value, onChange }: Props) => {
  let range = field.range!, selected: [number, number]
  try { selected = pluginRangeValue(value ?? field.default ?? String(range.min), range) } catch { selected = [range.min, range.max] }
  let [low, high] = selected
  let change = (event: ChangeEvent<HTMLInputElement>) => {
    let next = Number(event.target.value)
    let values = event.target.dataset.end === 'min' ? [Math.min(next, high), high] : [low, Math.max(low, next)]
    onChange(field.name, values[0] === values[1] ? String(values[0]) : values.join('-'))
  }
  let style = { '--range-start': (low - range.min) / (range.max - range.min) * 100 + '%', '--range-end': (high - range.min) / (range.max - range.min) * 100 + '%' } as CSSProperties
  return <div role="group" aria-label={field.title} className={css.field}>
    <div className={css.heading}><span>{field.title}</span><output>{low === high ? low : low + '–' + high}{range.unit}</output></div>
    <div className={css.track} style={style}>
      <input type="range" aria-label={field.title + ' minimum'} aria-valuetext={low + (range.unit ?? '')} data-end="min" min={range.min} max={range.max} step={range.step} value={low} onChange={change} />
      <input type="range" aria-label={field.title + ' maximum'} aria-valuetext={high + (range.unit ?? '')} data-end="max" min={range.min} max={range.max} step={range.step} value={high} onChange={change} />
    </div>
  </div>
}
