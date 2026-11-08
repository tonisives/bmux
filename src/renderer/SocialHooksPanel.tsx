import { useEffect, useState } from 'react'
import type { SocialHookConfig, SocialHookState } from '../shared/social-hooks'
import css from './Observations.module.css'

type Props = { pluginId: string; profiles: {id:string;name:string}[]; run: (method:string,args?:Record<string,unknown>) => Promise<unknown> }
export let SocialHooksPanel = ({pluginId,profiles,run}: Props) => {
  let [profile,setProfile] = useState(''), [state,setState] = useState<SocialHookState>(), [draft,setDraft] = useState<SocialHookConfig>(), [secret,setSecret] = useState<string>(), [error,setError] = useState(''), [busy,setBusy] = useState(false), [notice,setNotice] = useState('')
  useEffect(() => {
    let active = true
    setDraft(undefined); setSecret(undefined)
    let refresh = async () => { try { let result = await run('plugin.social-hooks.get',{id:pluginId,profile}) as SocialHookState; if (active) { setState(result); setDraft(current => current ?? result.config) } } catch { if(active) setError('Could not load social hooks') } }
    void refresh(); let timer = setInterval(() => { void refresh() },2000)
    return () => { active = false; clearInterval(timer) }
  },[pluginId,profile,run])
  let save = async (inherit = false) => {
    if (!draft) return
    setBusy(true); setError(''); setNotice('')
    try { let result = await run('plugin.social-hooks.save',{id:pluginId,profile,config:inherit ? null : {...draft,...(secret !== undefined ? {secret} : {})}}) as SocialHookState; setState(result); setDraft(result.config); setSecret(undefined); setNotice('Hook saved') }
    catch { setError('Could not save hook. Check the endpoint and authentication settings.') }
    finally { setBusy(false) }
  }
  let submit = (event: React.FormEvent) => { event.preventDefault(); void save() }
  let changeProfile = (event: React.ChangeEvent<HTMLSelectElement>) => { setProfile(event.target.value); setNotice(''); setError('') }
  let changeEnabled = (event: React.ChangeEvent<HTMLInputElement>) => { if(draft) setDraft({...draft,enabled:event.target.checked}) }
  let changeUrl = (event: React.ChangeEvent<HTMLInputElement>) => { if(draft) setDraft({...draft,url:event.target.value}) }
  let changeFormat = (event: React.ChangeEvent<HTMLSelectElement>) => { if(draft) setDraft({...draft,format:event.target.value as SocialHookConfig['format']}) }
  let changeAuth = (event: React.ChangeEvent<HTMLSelectElement>) => { if(draft) setDraft({...draft,auth:event.target.value as SocialHookConfig['auth']}) }
  let changeHeader = (event: React.ChangeEvent<HTMLInputElement>) => { if(draft) setDraft({...draft,header:event.target.value}) }
  let changeSecret = (event: React.ChangeEvent<HTMLInputElement>) => setSecret(event.target.value)
  let removeSecret = () => setSecret('')
  let inherit = () => { void save(true) }
  return <section className={css.panel} aria-label="Social post hooks">
    <p>Send observed posts from ordinary browsing and plugin sessions to a remote endpoint.</p>
    <label>Configuration<select value={profile} onChange={changeProfile}><option value="">Shared across profiles</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {profile && <p>{state?.override ? 'This profile overrides shared settings.' : 'This profile uses shared settings. Saving creates an override.'}</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!draft ? <p>Loading hook settings…</p> : <form className={css.form} onSubmit={submit}>
      <label className={css.checkbox}><input type="checkbox" checked={draft.enabled} onChange={changeEnabled}/>Send observed posts</label>
      <label>Endpoint URL<input type="url" required={draft.enabled} value={draft.url} onChange={changeUrl}/></label>
      <label>Payload format<select value={draft.format} onChange={changeFormat}><option value="posts">Social posts</option>{pluginId === 'bmux.x' && <option value="tweettrace">TweetTrace</option>}</select></label>
      <label>Authentication<select value={draft.auth} onChange={changeAuth}><option value="none">None</option><option value="bearer">Bearer token</option><option value="api-key">API key header</option></select></label>
      {draft.auth === 'api-key' && <label>Header name<input required value={draft.header} onChange={changeHeader}/></label>}
      {draft.auth !== 'none' && <><label>{draft.hasSecret ? 'Replace credential' : 'Credential'}<input type="password" autoComplete="new-password" value={secret ?? ''} onChange={changeSecret}/></label>{draft.hasSecret && <button type="button" onClick={removeSecret}>Remove credential</button>}</>}
      <div className={css.actions}><button disabled={busy} type="submit">{busy ? 'Saving…' : 'Save hook'}</button>{profile && state?.override && <button disabled={busy} type="button" onClick={inherit}>Use shared settings</button>}</div>
    </form>}
    {state && <><p>{state.sent} sent · {state.pending} pending · {state.failed} failed</p><h3>Recent deliveries</h3>{!state.recent.length && <p>No deliveries yet.</p>}{state.recent.map((item,index) => <p key={index}>{new Date(item.at).toLocaleString()} · {item.error || item.sent+' sent'}{item.inserted !== undefined && ' · '+item.inserted+' inserted'}{item.skipped !== undefined && ' · '+item.skipped+' skipped'}</p>)}</>}
  </section>
}
