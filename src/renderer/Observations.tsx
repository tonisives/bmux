import { useCallback, useEffect, useState } from 'react'
import type { Bridge } from '../shared/types'
import css from './Observations.module.css'

type Run = (method: string,args?: Record<string,unknown>) => Promise<unknown>
type Recording = { id: string; state: string; startedAt: number; finishedAt?: number; error?: string; directory: string; options: {pane?: string;sourcePane?:string}; clips: {pane:string;file:string;state:string}[] }
export let RecordingPanel = ({run}: {run:Run}) => {
  let {items,error,refresh} = useRecordings(run), [actionError,setActionError] = useState(''), [busy,setBusy] = useState(false)
  let action = async (method:string,id?:string) => {
    setBusy(true); setActionError('')
    try { await run(method,id ? {id} : {}); await refresh() }
    catch(error) { setActionError(error instanceof Error ? error.message : 'Recording request failed') }
    finally { setBusy(false) }
  }
  let openFolder = () => { void action('record.folder') }
  let recordingAction = (event: React.MouseEvent<HTMLButtonElement>) => { void action(event.currentTarget.dataset.method!,event.currentTarget.dataset.id!) }
  return <section className={css.panel} aria-label="Recordings">
    <p>Remote agent sessions are saved on this computer with the agent pointer visible.</p>
    <button type="button" disabled={busy} onClick={openFolder}>Open recordings folder</button>
    {(actionError || error) && <p role="alert">{actionError || error}</p>}
    <h3>Session history</h3>
    {!items.length && <p>No recorded sessions yet. Connect an activity hook in Remote settings to record remote agents automatically.</p>}
    {[...items].reverse().map(item=><article key={item.id} className={css.item}>
      <strong>{new Date(item.startedAt).toLocaleString()} · {item.state}</strong>
      {item.directory && <code>{item.directory}</code>}
      <span>{item.clips.length} {item.clips.length === 1 ? 'pane' : 'panes'}</span>
      {item.error && <p role="alert">{item.error}</p>}
      <div className={css.actions}>
        {!item.finishedAt && item.state !== 'interrupted' && <button type="button" disabled={busy} data-method="record.stop" data-id={item.id} onClick={recordingAction}>Stop</button>}
        {item.directory && <button type="button" disabled={busy} data-method="record.reveal" data-id={item.id} onClick={recordingAction}>Show files</button>}
        {item.clips.some(clip=>['saved','saved-webm'].includes(clip.state)) && <button type="button" disabled={busy} data-method="record.play" data-id={item.id} onClick={recordingAction}>Play</button>}
      </div>
    </article>)}
  </section>
}

type Hook = { id:string; enabled:boolean; has_secret?:boolean; filter:Record<string,string>; events:string[]; destination:{kind:'webhook'|'clawtab';url:string;deviceId?:string;job?:string} }
type Delivery = {id:string;status:string;attempts:number;error?:string}
type Account = Bridge['remoteAccount']
export let HooksPanel = ({account}: {account:Account}) => {
  let [items,setItems] = useState<Hook[]>([]), [editing,setEditing] = useState<Hook | null>(null), [secret,setSecret] = useState(''), [error,setError] = useState(''), [message,setMessage] = useState(''), [busy,setBusy] = useState(false), [deliveries,setDeliveries] = useState<Delivery[]>([])
  let refresh = useCallback(async()=>{ try { setItems(await account<Hook[]>('/api/hooks')); setError('') } catch(error) { setError(error instanceof Error ? error.message : 'Could not load hooks') } },[account])
  useEffect(()=>{ void refresh() },[refresh])
  let perform = async (task:()=>Promise<unknown>) => { setBusy(true); setError(''); setMessage(''); try { await task(); await refresh() } catch(error) { setError(error instanceof Error ? error.message : 'Hook request failed') } finally { setBusy(false) } }
  let start = (hook?:Hook) => { setEditing(hook ?? {id:'',enabled:false,filter:{},events:['agent.session.start','agent.session.end'],destination:{kind:'clawtab',url:'https://triggers.clawtab.cc/v1/triggers/run',job:'bmux/record-session',deviceId:''}});setSecret('');setDeliveries([]) }
  let editHook = (event: React.MouseEvent<HTMLButtonElement>) => start(items.find(item=>item.id===event.currentTarget.dataset.id))
  let hookAction = (event: React.MouseEvent<HTMLButtonElement>) => {
    let item=items.find(item=>item.id===event.currentTarget.dataset.id)!, action=event.currentTarget.dataset.action
    void perform(async()=>{
      if(action==='toggle'){await account(`/api/hooks/${item.id}`,{enabled:!item.enabled});setMessage(item.enabled?'Hook disabled':'Hook enabled')}
      if(action==='test'){await account(`/api/hooks/${item.id}/test`,{});setMessage('Test queued. The recording job checks connectivity without opening a browser.')}
      if(action==='deliveries')setDeliveries(await account<Delivery[]>(`/api/hooks/${item.id}/deliveries`))
      if(action==='delete')await account(`/api/hooks/${item.id}`,undefined,'DELETE')
    })
  }
  let submit = (event: React.FormEvent) => {event.preventDefault();void perform(save)}
  let cancel = () => {setEditing(null);setSecret('')}
  let changeKind = (event: React.ChangeEvent<HTMLSelectElement>) => {if(editing)setEditing({...editing,destination:{...editing.destination,kind:event.target.value as 'webhook'|'clawtab',url:event.target.value==='clawtab'?'https://triggers.clawtab.cc/v1/triggers/run':''}})}
  let changeDestination = (event: React.ChangeEvent<HTMLInputElement>) => {if(editing)setEditing({...editing,destination:{...editing.destination,[event.target.name]:event.target.value}})}
  let changeFilter = (event: React.ChangeEvent<HTMLInputElement>) => {if(!editing)return;let filter={...editing.filter};if(event.target.value)filter[event.target.name]=event.target.value;else delete filter[event.target.name];setEditing({...editing,filter})}
  let changeEvents = (event: React.ChangeEvent<HTMLInputElement>) => {if(editing)setEditing({...editing,events:event.target.checked?[...editing.events,event.target.name]:editing.events.filter(t=>t!==event.target.name)})}
  let changeSecret = (event: React.ChangeEvent<HTMLInputElement>) => setSecret(event.target.value)
  let changeEnabled = (event: React.ChangeEvent<HTMLInputElement>) => {if(editing)setEditing({...editing,enabled:event.target.checked})}
  let save = async () => { if(!editing) return; await account(`/api/hooks${editing.id ? `/${editing.id}` : ''}`,{...editing,...(secret ? {secret} : {})});setEditing(null);setSecret('');setMessage('Hook saved') }
  return <section className={css.panel} aria-label="Activity hooks"><h3>Activity hooks</h3><p>Run a ClawTab job or call a webhook when an agent starts browsing, completes an action, or becomes idle for 30 seconds.</p>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button type="button" disabled={busy} onClick={()=>start()}>Add hook</button>{!items.length && !error && <p>No hooks configured.</p>}{items.map(item=><article key={item.id} className={css.item}><strong>{item.destination.kind === 'clawtab' ? item.destination.job : item.destination.url}</strong><span>{item.enabled ? 'Enabled' : 'Disabled'} · {Object.entries(item.filter).map(([k,v])=>`${k}: ${v}`).join(', ') || 'All agent sessions'}</span><div className={css.actions}><button type="button" disabled={busy} data-id={item.id} onClick={editHook}>Edit</button><button type="button" disabled={busy} data-id={item.id} data-action="toggle" onClick={hookAction}>{item.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={busy} data-id={item.id} data-action="test" onClick={hookAction}>Test delivery</button><button type="button" disabled={busy} data-id={item.id} data-action="deliveries" onClick={hookAction}>Deliveries</button><button type="button" disabled={busy} data-id={item.id} data-action="delete" onClick={hookAction}>Delete</button></div></article>)}{editing && <form className={css.form} onSubmit={submit}><label>Destination<select value={editing.destination.kind} onChange={changeKind}><option value="clawtab">ClawTab job</option><option value="webhook">HTTPS webhook</option></select></label>{editing.destination.kind === 'clawtab' ? <><label>Device ID<input required value={editing.destination.deviceId ?? ''} name="deviceId" onChange={changeDestination}/></label><label>Job<input required value={editing.destination.job ?? ''} name="job" onChange={changeDestination}/></label></> : <label>URL<input type="url" required value={editing.destination.url} name="url" onChange={changeDestination}/></label>}<label>{editing.has_secret ? 'Replace token (leave blank to keep)' : 'Bearer token'}<input type="password" autoComplete="new-password" value={secret} onChange={changeSecret}/></label><fieldset><legend>Match activity</legend>{['serviceId','hostId','sessionId','paneId','profileId','agentId'].map(key=><label key={key}>{key}<input value={editing.filter[key] ?? ''} name={key} onChange={changeFilter}/></label>)}</fieldset><fieldset><legend>Events</legend>{['agent.session.start','agent.action','agent.session.end'].map(type=><label key={type} className={css.checkbox}><input type="checkbox" checked={editing.events.includes(type)} name={type} onChange={changeEvents}/>{type}</label>)}</fieldset><label className={css.checkbox}><input type="checkbox" checked={editing.enabled} onChange={changeEnabled}/>Enabled</label><div className={css.actions}><button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save hook'}</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></div></form>}{deliveries.length > 0 && <div aria-label="Recent deliveries">{deliveries.map(item=><p key={item.id}><code>{item.id.slice(0,8)}</code> · {item.status}{item.error ? ` · ${item.error}` : ''}</p>)}</div>}</section>
}

let useRecordings = (run: Run) => {
  let [items,setItems] = useState<Recording[]>([]), [error,setError] = useState('')
  let refresh = useCallback(async () => { try { let value = await run('record.list'); if(Array.isArray(value)) setItems(value) } catch(error) { setError(error instanceof Error ? error.message : 'Could not load recordings') } },[run])
  useEffect(()=>{ void refresh(); let timer = setInterval(()=>void refresh(),2000); return ()=>clearInterval(timer) },[refresh])
  return {items,error,refresh}
}
