import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ACCOUNT_PLATFORMS } from '../../src/shared/managed-accounts'
import type { AccountsSnapshot } from '../../src/shared/managed-accounts'
import styles from './accounts.module.css'

let request = async <T,>(path: string, value?: unknown): Promise<T> => {
  let response = await fetch(path, { credentials: 'same-origin', ...(value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }) })
  let result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Account request failed')
  return result as T
}
export let AccountsDashboard = () => {
  let [data, setData] = useState<AccountsSnapshot>(), [project, setProject] = useState(''), [section, setSection] = useState('overview')
  let [error, setError] = useState(''), [busy, setBusy] = useState(false), [form, setForm] = useState('')
  let [selected, setSelected] = useState('')
  let load = async () => { setData(await request<AccountsSnapshot>('/api/v1/accounts/overview')) }
  useEffect(() => { let active = true; void request<AccountsSnapshot>('/api/v1/accounts/overview').then(value => { if (active) setData(value) }).catch(value => { if (active) setError(value.message) }); return () => { active = false } }, [])
  let act = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); setForm('') } catch (value) { setError((value as Error).message) } finally { setBusy(false) } }
  let submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    let values = Object.fromEntries(new FormData(event.currentTarget)), input: Record<string, unknown> = { ...values }
    if (form === 'schedule') { input.scheduledAt = new Date(String(values.time)).toISOString(); input.durationMinutes = Number(values.durationMinutes); delete input.time }
    void act(() => request('/api/v1/' + ({ project: 'projects', persona: 'personas', account: 'accounts', schedule: 'schedules' }[form]), input))
  }
  let personas = data?.personas.filter(item => !project || item.project_id === project) ?? []
  let accounts = data?.accounts.filter(item => personas.some(persona => persona.id === item.persona_id)) ?? []
  let schedules = data?.schedules.filter(item => accounts.some(account => account.id === item.account_id)) ?? []
  let account = accounts.find(item => item.id === selected)
  let currentProject = data?.projects.find(item => item.id === project)
  return <main className={styles.dashboard}>
    <aside className={styles.navigation} aria-label="Account navigation"><h1>Accounts</h1><label>Project<select value={project} onChange={event => { setProject(event.target.value); setSelected('') }}><option value="">All projects</option>{data?.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <nav>{['overview','personas','calendar'].map(item => <button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => { setSection(item); setSelected('') }}>{item === 'overview' ? 'Overview' : item === 'personas' ? 'Personas' : 'Calendar'}</button>)}</nav>
      <button onClick={() => setForm('project')}>Add project</button><p>Account workspace preview</p>
    </aside>
    <section className={styles.content}>
      <header className={styles.heading}><div><p>{currentProject?.name ?? 'All projects'}</p><h2>{section === 'calendar' ? 'Project calendar' : section === 'personas' ? 'Personas' : 'Account overview'}</h2></div><div className={styles.actions}><button disabled={!data?.projects.length} onClick={() => setForm('persona')}>Add persona</button><button disabled={!personas.length} onClick={() => setForm('account')}>Add account</button><button disabled={!accounts.length} onClick={() => setForm('schedule')}>Schedule job</button></div></header>
      {error && <p role="alert">{error} <button disabled={busy} onClick={() => void act(load)}>Retry</button></p>}
      {!data && !error && <p aria-busy="true">Loading account workspace…</p>}
      {data && <>
        <p className={styles.notice}>Accounts are drafts. Identity sealing, proxy assignment, host control, and job execution are not connected yet.</p>
        {form && <form className={styles.form} onSubmit={submit}><h3>{form === 'schedule' ? 'Plan a job' : 'Add ' + form}</h3>
          {form === 'project' && <><label>Name<input name="name" required maxLength={120} /></label><label>Timezone<input name="timezone" required defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} /></label></>}
          {form === 'persona' && <><label>Project<select name="projectId" defaultValue={project} required>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Name<input name="name" required maxLength={120} /></label><label>Interests<textarea name="interests" maxLength={4000} /></label></>}
          {form === 'account' && <><label>Persona<select name="personaId" required>{personas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Platform<select name="platform">{ACCOUNT_PLATFORMS.map(item => <option key={item}>{item}</option>)}</select></label><label>Handle<input name="handle" required maxLength={120} /></label></>}
          {form === 'schedule' && <><label>Account<select name="accountId" required>{accounts.map(item => <option key={item.id} value={item.id}>{item.handle} · {item.platform}</option>)}</select></label><label>Kind<select name="kind"><option value="warmup">Warmup</option><option value="post">Post</option><option value="analytics">Analytics</option></select></label><label>Installed job<input name="job" required maxLength={200} /></label><label>Start ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input name="time" type="datetime-local" required /></label><label>Duration in minutes<input name="durationMinutes" type="number" min="1" max="180" defaultValue="15" required /></label><p>This saves a blocked calendar entry. It will not execute.</p></>}
          <div className={styles.actions}><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</button><button type="button" disabled={busy} onClick={() => setForm('')}>Cancel</button></div>
        </form>}
        {section === 'overview' && <><div className={styles.totals}><div><strong>{accounts.length}</strong>Accounts</div><div><strong>{personas.length}</strong>Personas</div><div><strong>{schedules.filter(item => item.status !== 'cancelled').length}</strong>Planned jobs</div></div>
          {accounts.length ? <div className={styles.table}><table><thead><tr><th>Account</th><th>Platform</th><th>Persona</th><th>Status</th></tr></thead><tbody>{accounts.map(item => <tr key={item.id}><td><button onClick={() => setSelected(item.id)}>{item.handle}</button></td><td>{item.platform}</td><td>{personas.find(persona => persona.id === item.persona_id)?.name}</td><td>{item.status}</td></tr>)}</tbody></table></div> : <div className={styles.empty}><h3>{data.projects.length ? 'Add your first account' : 'Start with a project'}</h3><p>Group your accounts by project and persona, then plan their daily work.</p><button onClick={() => setForm(!data.projects.length ? 'project' : !personas.length ? 'persona' : 'account')}>{!data.projects.length ? 'Add project' : !personas.length ? 'Add persona' : 'Add account'}</button></div>}
          {account && <article className={styles.detail}><button onClick={() => setSelected('')}>Close details</button><h3>{account.handle}</h3><p>{account.platform} · {account.status}</p><dl><dt>Proxy</dt><dd>Unassigned</dd><dt>Host</dt><dd>Unassigned</dd><dt>Identity</dt><dd>Not sealed</dd><dt>Growth analytics</dt><dd>Not collected</dd></dl></article>}</>}
        {section === 'personas' && (personas.length ? personas.map(item => <article className={styles.detail} key={item.id}><h3>{item.name}</h3><p>{item.interests || 'No interests set'}</p><p>{accounts.filter(account => account.persona_id === item.id).length} accounts</p></article>) : <p>No personas yet. Add a project, then its personas.</p>)}
        {section === 'calendar' && <><p>Agenda · {currentProject?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{schedules.length ? schedules.map(item => <article className={styles.detail} key={item.id}><time dateTime={item.scheduled_at}>{new Date(item.scheduled_at).toLocaleString(undefined, { timeZone: currentProject?.timezone })}</time><h3>{item.kind} · {accounts.find(account => account.id === item.account_id)?.handle}</h3><p>{item.job} · {item.duration_minutes} minutes · {item.status}</p>{item.status !== 'cancelled' && <button disabled={busy} onClick={() => void act(() => request('/api/v1/schedules/' + item.id + '/cancel', {}))}>Cancel job</button>}</article>) : <p>No jobs planned. Schedule a warmup, post, or analytics collection.</p>}</>}
      </>}
    </section>
  </main>
}
