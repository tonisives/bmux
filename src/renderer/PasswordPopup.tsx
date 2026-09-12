import { useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import type { Bridge, PasswordSuggestions } from '../shared/types'
import css from './PasswordPopup.module.css'

export let PasswordPopup = () => {
  let [suggestion, setSuggestion] = useState<PasswordSuggestions>()
  useEffect(() => {
    let unsubscribe = bridge.subscribe(state => setSuggestion(state.passwordSuggestions))
    void bridge.state().then(state => setSuggestion(state.passwordSuggestions))
    return unsubscribe
  }, [])
  return suggestion ? <PasswordChoices key={suggestion.id} suggestion={suggestion} /> : null
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
let PasswordChoices = ({ suggestion }: { suggestion: PasswordSuggestions }) => {
  let [pending, setPending] = useState(false), [error, setError] = useState('')
  let input = useRef<HTMLInputElement>(null)
  let busy = pending || suggestion.busy
  useEffect(() => { if (suggestion.expanded && suggestion.locked && !busy) input.current?.focus() }, [suggestion.expanded, suggestion.locked, busy])
  let command = async (method: string, args: Record<string, unknown> = {}) => {
    setPending(true); setError('')
    try { await bridge.command({ method, args: { suggestion: suggestion.id, ...args } }) }
    catch { setError('The login field changed. Click the field and try again.') }
    finally { setPending(false) }
  }
  let unlock = () => { void command('bitwarden.prepare') }
  let submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy || !input.current) return
    let password = input.current.value
    input.current.value = ''
    void command('bitwarden.unlock', { password })
  }
  let retry = () => { void command('bitwarden.refresh') }
  let choose = (event: MouseEvent<HTMLButtonElement>) => { void command('bitwarden.select', { id: event.currentTarget.dataset.loginId }) }
  let close = () => { void command('bitwarden.dismiss') }
  return <section className={css.popup} role="group" aria-label="Bitwarden logins">
    <header><strong>Bitwarden</strong><span title={suggestion.origin}>{suggestion.origin}</span><button aria-label="Close password suggestions" onClick={close}>×</button></header>
    <div className={css.content}>
      {suggestion.locked && !suggestion.expanded && <button className={css.unlock} onClick={unlock}>Unlock Bitwarden</button>}
      {suggestion.locked && suggestion.expanded && <form onSubmit={submit}>
        <label htmlFor="master-password">Master password</label>
        <input id="master-password" ref={input} type="password" autoComplete="off" required disabled={busy} />
        <button type="submit" disabled={busy}>Unlock</button>
      </form>}
      {busy && <p role="status">{suggestion.locked ? 'Unlocking Bitwarden…' : 'Loading logins…'}</p>}
      {!busy && (error || suggestion.message) && <p role="alert">{error || suggestion.message}</p>}
      {!suggestion.locked && !busy && suggestion.message && <button onClick={retry}>Try again</button>}
      {!suggestion.locked && !busy && !suggestion.message && !suggestion.items.length && <p>No logins saved for this site.</p>}
      {!suggestion.locked && !busy && suggestion.items.map(item => <button className={css.login} key={item.id} data-login-id={item.id} onClick={choose} aria-label={`Fill login ${item.username || item.name}`}><strong>{item.username || item.name}</strong><span>{item.name}</span></button>)}
    </div>
  </section>
}
