import { useEffect, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent, MouseEvent } from 'react'
import { AGENT_FEEDBACK_RANGES, DEFAULT_AGENT_FEEDBACK, parseAgentFeedback, resolveAgentFeedback } from '../shared/agent-feedback'
import type { AgentFeedbackSettings as Feedback } from '../shared/agent-feedback'
import css from './AgentFeedbackSettings.module.css'
import panel from './App.module.css'

export type FeedbackSection = 'appearance' | 'timing'

export let FeedbackTabIcon = ({ tab }: { tab: 'protection' | FeedbackSection }) => <svg className={css.tabIcon} viewBox="0 0 24 24" aria-hidden="true"><path d={tab === 'protection' ? 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6zM8 12l3 3 5-6' : tab === 'appearance' ? 'm5 3 3 17 4-6 7-3ZM15 17l3 4' : 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2'} /></svg>

export let AgentFeedbackSettings = ({ value, save, profileId, section }: { value: Feedback; profileId?: string; section?: FeedbackSection; save: (value: Feedback) => Promise<unknown> }) => {
  let saved = JSON.stringify(value)
  let [draft, setDraft] = useState(() => fields(value)), [selected, setSelected] = useState<FeedbackSection>('appearance'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  let tab = section ?? selected
  let selectTab = (event: MouseEvent<HTMLButtonElement>) => setSelected(event.currentTarget.dataset.section as FeedbackSection)
  useEffect(() => { setDraft(fields(JSON.parse(saved))) }, [saved])
  let parsed = () => {
    if (Object.values(draft).some(amount => !amount.trim())) throw new Error('Enter a value for every setting')
    return parseAgentFeedback(Object.fromEntries(Object.entries(draft).map(([key, amount]) => [key, key === 'color' ? amount : seconds.has(key) ? Math.round(Number(amount) * 1000) : Number(amount)])))
  }
  let changeValues = (values: Record<string, string>) => { setDraft(current => ({ ...current, ...values })); setError(''); setNotice('') }
  let changeField = (name: string, value: string) => changeValues({ [name]: value })
  let change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => changeField(event.target.name, event.target.value)
  let colorSource = (event: ChangeEvent<HTMLSelectElement>) => {
    setDraft(current => ({ ...current, color: event.target.value === 'profile' ? 'profile' : resolveAgentFeedback({ ...value, color: 'profile' }, profileId).color })); setError(''); setNotice('')
  }
  let apply = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true)
    try { if (await save(parsed())) setNotice('Saved') } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  let reset = () => {
    let defaults = fields(DEFAULT_AGENT_FEEDBACK), keys: string[] = numericFields.filter(([, , , group]) => group === tab).map(([key]) => key)
    if (tab === 'appearance') keys.push('color')
    else keys.push('actionDelayMinMs', 'actionDelayMaxMs')
    changeValues(Object.fromEntries(keys.map(key => [key, defaults[key]])))
  }
  let preview = value
  try { preview = parsed() } catch { /* Keep the last valid preview while editing. */ }
  preview = resolveAgentFeedback(preview, profileId)
  return <form className={css.controls} onSubmit={apply} aria-label="Cursor and timing">
    {!section && <div className={panel.panelTabs} role="tablist" aria-label="Cursor settings">
      <button type="button" role="tab" data-section="appearance" aria-selected={tab === 'appearance'} onClick={selectTab}><FeedbackTabIcon tab="appearance" />Appearance</button>
      <button type="button" role="tab" data-section="timing" aria-selected={tab === 'timing'} onClick={selectTab}><FeedbackTabIcon tab="timing" />Timing</button>
    </div>}
    <h2>{tab === 'appearance' ? 'Cursor appearance' : 'Timing'}</h2>
    <p className={css.hint}>Shared across all profiles.{tab === 'appearance' ? ' The default color follows each pane’s profile.' : ' Social-site delays are set in Protection.'}</p>
    {tab === 'appearance' && <svg className={css.preview} viewBox="0 0 180 100" aria-label="Agent cursor preview" role="img" style={{ '--cursor-angle': `${preview.idleRotationDegrees}deg`, '--cursor-cycle': `${preview.idleRotationMs}ms` } as CSSProperties}>
      {!!preview.trailWidth && !!preview.trailFadeMs && <path d="M22 75Q45 38 112 45" fill="none" stroke={preview.color} strokeWidth={preview.trailWidth} opacity=".35" strokeLinecap="round" />}
      {!!preview.haloSize && !!preview.haloDurationMs && <circle cx="112" cy="45" r={preview.haloSize / 2} fill={`${preview.color}22`} stroke={preview.color} strokeWidth="2" />}
      <g className={preview.idleRotationDegrees ? css.idle : undefined}><svg x="110" y="43" width={preview.cursorSize} height={preview.cursorSize * 27 / 24} viewBox="0 0 32 36"><path d="M4 3.6Q2.2 2.3 2.6 4.5L7.6 27Q8 28.8 9.3 27.4L25 12.7Q26.5 11.4 24.5 10.8Z" fill={preview.color} stroke="#5b2848" strokeWidth="1.4" /></svg></g>
    </svg>}
    <div role="tabpanel" aria-label={tab === 'appearance' ? 'Cursor appearance' : 'Cursor timing'}>
      {tab === 'timing' && <ActionPause minimum={draft.actionDelayMinMs} maximum={draft.actionDelayMaxMs} busy={busy} change={changeValues} />}
      {tab === 'appearance' && <div className={`${css.row} ${css.colorControls}`}><span>Cursor color</span>
        <select aria-label="Cursor color source" value={draft.color === 'profile' ? 'profile' : 'custom'} onChange={colorSource} disabled={busy}><option value="profile">Profile color</option><option value="custom">Custom</option></select>
        <input type="color" name="color" aria-label="Custom cursor color" value={preview.color} onChange={change} disabled={busy || draft.color === 'profile'} />
      </div>}
      {numericFields.filter(([, , , group]) => group === tab).map(([key, label, unit]) => {
        let scale = seconds.has(key) ? 1000 : 1, [minimum, maximum] = AGENT_FEEDBACK_RANGES[key]
        return <SettingSlider key={key} name={key} label={label} unit={unit} minimum={minimum / scale} maximum={maximum / scale} step={scale === 1000 ? .1 : 1} value={draft[key]} change={changeField} busy={busy} />
      })}
    </div>
    {error && <p role="alert" className={css.error}>{error}</p>}
    <footer className={css.actions}><span role="status">{notice}</span><button type="button" onClick={reset} disabled={busy}>Reset defaults</button><button type="submit" disabled={busy}>Apply</button></footer>
  </form>
}

let pausePresets = { Fast: [0, 200], Medium: [800, 1200], Safe: [1500, 2500] } as const

type SliderProps = { name: string; label: string; unit: string; value: string; minimum: number; maximum: number; step: number; busy: boolean; change: (name: string, value: string) => void }
let SettingSlider = ({ name, label, unit, value, minimum, maximum, step, busy, change }: SliderProps) => {
  let nonlinear = name.endsWith('Ms')
  let position = nonlinear ? Math.sqrt(Math.max(0, Number(value)) / maximum) * 1000 : Number(value)
  let slide = (event: ChangeEvent<HTMLInputElement>) => change(name, String(nonlinear ? Math.max(minimum, Math.round((Number(event.target.value) / 1000) ** 2 * maximum / step) * step) : Number(event.target.value)))
  let edit = (event: ChangeEvent<HTMLInputElement>) => change(name, event.target.value)
  return <label className={css.row}><span>{label}<small>{unit}</small></span>
    <input className={css.slider} type="range" aria-label={`${label} slider`} aria-valuetext={`${value} ${unit.split(' ·')[0]}`} min={nonlinear ? 0 : minimum} max={nonlinear ? 1000 : maximum} step={nonlinear ? 1 : step} value={position} onChange={slide} disabled={busy} />
    <input required type="number" name={name} aria-label={label} min={minimum} max={maximum} step={step} value={value} onChange={edit} disabled={busy} />
  </label>
}

let ActionPause = ({ minimum, maximum, busy, change }: { minimum: string; maximum: string; busy: boolean; change: (values: Record<string, string>) => void }) => {
  let position = (value: string) => Math.sqrt(Math.max(0, Number(value)) / 30000) * 1000
  let slide = (event: ChangeEvent<HTMLInputElement>) => {
    let amount = Math.round((Number(event.target.value) / 1000) ** 2 * 30000 / 50) * 50
    change({ [event.target.name]: String(event.target.name === 'actionDelayMinMs' ? Math.min(amount, Number(maximum)) : Math.max(amount, Number(minimum))) })
  }
  let edit = (event: ChangeEvent<HTMLInputElement>) => change({ [event.target.name]: event.target.value })
  let preset = (event: MouseEvent<HTMLButtonElement>) => {
    let [minimum, maximum] = pausePresets[event.currentTarget.dataset.preset as keyof typeof pausePresets]
    change({ actionDelayMinMs: String(minimum), actionDelayMaxMs: String(maximum) })
  }
  return <section className={css.pause} aria-label="Action pause"><h3>Action pause</h3><p>Random pause between commands · milliseconds</p>
    <div className={css.presets} role="group" aria-label="Action pause presets">{Object.entries(pausePresets).map(([name, [min, max]]) => <button key={name} type="button" data-preset={name} aria-pressed={Number(minimum) === min && Number(maximum) === max} onClick={preset} disabled={busy}>{name}</button>)}</div>
    <div className={css.pauseRange} style={{ '--range-start': `${position(minimum) / 10}%`, '--range-end': `${position(maximum) / 10}%` } as CSSProperties}>
      <input type="range" name="actionDelayMinMs" aria-label="Minimum action pause slider" aria-valuetext={`${minimum} milliseconds`} min="0" max="1000" value={position(minimum)} onChange={slide} disabled={busy} />
      <input type="range" name="actionDelayMaxMs" aria-label="Maximum action pause slider" aria-valuetext={`${maximum} milliseconds`} min="0" max="1000" value={position(maximum)} onChange={slide} disabled={busy} />
    </div>
    <div className={css.pauseValues}><label>Minimum<input required type="number" name="actionDelayMinMs" aria-label="Minimum action pause" min="0" max="30000" value={minimum} onChange={edit} disabled={busy} /></label><span>to</span><label>Maximum<input required type="number" name="actionDelayMaxMs" aria-label="Maximum action pause" min="0" max="30000" value={maximum} onChange={edit} disabled={busy} /></label></div>
  </section>
}

let seconds = new Set(['cursorHideMs', 'commandDisplayMs', 'inputUnlockMs'])
let fields = (value: Feedback) => Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, String(seconds.has(key) ? Number(amount) / 1000 : amount)]))
let numericFields = [
  ['cursorSize', 'Cursor size', 'px', 'appearance'],
  ['idleRotationDegrees', 'Idle rotation', 'degrees · 0 is off', 'appearance'],
  ['haloSize', 'Click halo size', 'px · 0 is off', 'appearance'],
  ['trailWidth', 'Movement trail width', 'px · 0 is off', 'appearance'],
  ['idleRotationMs', 'Idle rotation cycle', 'ms', 'appearance'],
  ['haloDurationMs', 'Click halo duration', 'ms · 0 is off', 'appearance'],
  ['trailFadeMs', 'Movement trail fade', 'ms · 0 is off', 'appearance'],
  ['cursorHideMs', 'Hide cursor after', 'seconds · 0 keeps it visible', 'appearance'],
  ['commandDisplayMs', 'Command label duration', 'seconds · 0 is off', 'appearance'],
  ['inputUnlockMs', 'Unlock page after', 'seconds after commands finish', 'timing']
] as const

