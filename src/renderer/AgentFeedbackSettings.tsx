import { useEffect, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent } from 'react'
import { AGENT_FEEDBACK_RANGES, DEFAULT_AGENT_FEEDBACK, parseAgentFeedback, resolveAgentFeedback } from '../shared/agent-feedback'
import type { AgentFeedbackSettings as Feedback } from '../shared/agent-feedback'
import css from './AgentFeedbackSettings.module.css'
import panel from './App.module.css'

export let AgentFeedbackSettings = ({ value, save, profileId, heading = true }: { value: Feedback; profileId?: string; heading?: boolean; save: (value: Feedback) => Promise<unknown> }) => {
  let saved = JSON.stringify(value)
  let [draft, setDraft] = useState(() => fields(value)), [tab, setTab] = useState('appearance'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  useEffect(() => { setDraft(fields(JSON.parse(saved))) }, [saved])
  let parsed = () => {
    if (Object.values(draft).some(amount => !amount.trim())) throw new Error('Enter a value for every setting')
    return parseAgentFeedback(Object.fromEntries(Object.entries(draft).map(([key, amount]) => [key, key === 'color' ? amount : seconds.has(key) ? Math.round(Number(amount) * 1000) : Number(amount)])))
  }
  let change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setDraft(current => ({ ...current, [event.target.name]: event.target.value })); setError(''); setNotice('') }
  let colorSource = (event: ChangeEvent<HTMLSelectElement>) => {
    setDraft(current => ({ ...current, color: event.target.value === 'profile' ? 'profile' : resolveAgentFeedback({ ...value, color: 'profile' }, profileId).color })); setError(''); setNotice('')
  }
  let apply = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice(''); setBusy(true)
    try { if (await save(parsed())) setNotice('Saved') } catch (error) { setError(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  let reset = () => { setDraft(fields(DEFAULT_AGENT_FEEDBACK)); setError(''); setNotice('') }
  let preview = value
  try { preview = parsed() } catch { /* Keep the last valid preview while editing. */ }
  preview = resolveAgentFeedback(preview, profileId)
  return <form className={css.controls} onSubmit={apply} aria-label="Cursor and timing">
    {heading && <h2>Cursor and timing</h2>}
    <svg className={css.preview} viewBox="0 0 180 100" aria-label="Agent cursor preview" role="img" style={{ '--cursor-angle': `${preview.idleRotationDegrees}deg`, '--cursor-cycle': `${preview.idleRotationMs}ms` } as CSSProperties}>
      {!!preview.trailWidth && !!preview.trailFadeMs && <path d="M22 75Q45 38 112 45" fill="none" stroke={preview.color} strokeWidth={preview.trailWidth} opacity=".35" strokeLinecap="round" />}
      {!!preview.haloSize && !!preview.haloDurationMs && <circle cx="112" cy="45" r={preview.haloSize / 2} fill={`${preview.color}22`} stroke={preview.color} strokeWidth="2" />}
      <g className={preview.idleRotationDegrees ? css.idle : undefined}><svg x="110" y="43" width={preview.cursorSize} height={preview.cursorSize * 27 / 24} viewBox="0 0 32 36"><path d="M4 3.6Q2.2 2.3 2.6 4.5L7.6 27Q8 28.8 9.3 27.4L25 12.7Q26.5 11.4 24.5 10.8Z" fill={preview.color} stroke="#5b2848" strokeWidth="1.4" /></svg></g>
    </svg>
    <div className={panel.panelTabs} role="tablist" aria-label="Cursor settings">
      <button type="button" role="tab" aria-selected={tab === 'appearance'} onClick={() => setTab('appearance')}>Appearance</button>
      <button type="button" role="tab" aria-selected={tab === 'timing'} onClick={() => setTab('timing')}>Timing</button>
    </div>
    <div role="tabpanel" aria-label={tab === 'appearance' ? 'Cursor appearance' : 'Cursor timing'}>
      {tab === 'timing' && <p className={css.hint}>Social-site delays are set in Profile limits.</p>}
      {tab === 'appearance' && <div className={`${css.row} ${css.colorControls}`}><span>Cursor color</span>
        <select aria-label="Cursor color source" value={draft.color === 'profile' ? 'profile' : 'custom'} onChange={colorSource} disabled={busy}><option value="profile">Profile color</option><option value="custom">Custom</option></select>
        <input type="color" name="color" aria-label="Custom cursor color" value={preview.color} onChange={change} disabled={busy || draft.color === 'profile'} />
      </div>}
      {numericFields.filter(([, , , group]) => group === tab).map(([key, label, unit]) => {
        let scale = seconds.has(key) ? 1000 : 1, [minimum, maximum] = AGENT_FEEDBACK_RANGES[key]
        return <label className={css.row} key={key}><span>{label}<small>{unit}</small></span><input required type="number" name={key} aria-label={label} min={minimum / scale} max={maximum / scale} step={scale === 1000 ? .1 : 1} value={draft[key]} onChange={change} disabled={busy} /></label>
      })}
    </div>
    {error && <p role="alert" className={css.error}>{error}</p>}
    <footer className={css.actions}><span role="status">{notice}</span><button type="button" onClick={reset} disabled={busy}>Reset defaults</button><button type="submit" disabled={busy}>Apply</button></footer>
  </form>
}

let seconds = new Set(['cursorHideMs', 'commandDisplayMs', 'inputUnlockMs'])
let fields = (value: Feedback) => Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, String(seconds.has(key) ? Number(amount) / 1000 : amount)]))
let numericFields = [
  ['cursorSize', 'Cursor size', 'px', 'appearance'],
  ['idleRotationDegrees', 'Idle rotation', 'degrees · 0 is off', 'appearance'],
  ['haloSize', 'Click halo size', 'px · 0 is off', 'appearance'],
  ['trailWidth', 'Movement trail width', 'px · 0 is off', 'appearance'],
  ['idleRotationMs', 'Idle rotation cycle', 'ms', 'timing'],
  ['haloDurationMs', 'Click halo duration', 'ms · 0 is off', 'timing'],
  ['trailFadeMs', 'Movement trail fade', 'ms · 0 is off', 'timing'],
  ['cursorHideMs', 'Hide cursor after', 'seconds · 0 keeps it visible', 'timing'],
  ['commandDisplayMs', 'Command label duration', 'seconds · 0 is off', 'timing'],
  ['inputUnlockMs', 'Unlock page after', 'seconds after commands finish', 'timing'],
  ['actionDelayMinMs', 'Minimum action pause', 'ms', 'timing'],
  ['actionDelayMaxMs', 'Maximum action pause', 'ms', 'timing']
] as const

