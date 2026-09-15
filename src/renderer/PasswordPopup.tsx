import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react'
import type { Bridge, PasswordSuggestions } from '../shared/types'
import css from './PasswordPopup.module.css'
import { SearchInput } from './SearchInput'

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
  let [pending, setPending] = useState(false), [error, setError] = useState(''), [query, setQuery] = useState('')
  let [selected, setSelected] = useState(0)
  let input = useRef<HTMLInputElement>(null), search = useRef<HTMLInputElement>(null)
  let busy = pending || suggestion.busy
  useEffect(() => { if (suggestion.expanded && suggestion.locked && !busy) input.current?.focus() }, [suggestion.expanded, suggestion.locked, busy])
  useEffect(() => bridge.controls(control => {
    if (control === 'password-search') { search.current?.focus(); search.current?.select() }
  }), [])
  let normalized = query.trim().toLowerCase()
  let items = normalized ? suggestion.items.filter(item => `${item.username} ${item.name}`.toLowerCase().includes(normalized)) : suggestion.items
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
  let change = (event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setSelected(0) }
  let navigate = (event: KeyboardEvent<HTMLInputElement>) => {
    if (busy || !items.length || event.nativeEvent.isComposing) return
    if (event.key === 'Enter') { event.preventDefault(); void command('bitwarden.select', { id: items[Math.min(selected, items.length - 1)].id }) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      let next = (selected + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      setSelected(next)
      document.getElementById(`password-account-${next}`)?.scrollIntoView({ block: 'nearest' })
    }
  }
  return <section className={css.popup} role="group" aria-label="Bitwarden logins">
    <header><strong>Bitwarden</strong><span title={suggestion.origin}>{suggestion.origin}</span><button aria-label="Close password suggestions" onClick={close}>×</button></header>
    {!suggestion.locked && !busy && !!suggestion.items.length && <SearchInput aria-label="Search accounts" ref={search} type="search" value={query} onChange={change} onKeyDown={navigate} />}
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
      {!suggestion.locked && !busy && !!suggestion.items.length && !items.length && <p role="status">No matching accounts.</p>}
      {!suggestion.locked && !busy && items.map((item, index) => <button className={css.login} key={item.id} id={`password-account-${index}`} aria-pressed={index === Math.min(selected, items.length - 1)} data-login-id={item.id} onClick={choose} aria-label={`Fill login ${item.username || item.name}`}><strong>{item.username || item.name}</strong><span>{item.name}</span></button>)}
    </div>
  </section>
}
