import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fingerprintSettings, parseFingerprint } from '../../src/shared/fingerprint'
import type { FingerprintCatalog, FingerprintPane, FingerprintProfile, FingerprintRecord } from '../../src/shared/fingerprint'
import { api } from './client'
import type { createViewer } from './client'
import { FingerprintFields } from './FingerprintFields'
import type { FingerprintSection } from './FingerprintFields'
import css from './SessionFingerprints.module.css'

let unavailable: Record<string,string> = {
  STALE_FINGERPRINT:'The fingerprint changed. Try the latest version.',
  FINGERPRINT_PROXY_CREDENTIALS_REQUIRED:'This proxy needs a username and password.',
  FINGERPRINT_PROXY_CREDENTIALS_UNAVAILABLE:'This host cannot save proxy credentials.',
  FINGERPRINT_PROXY_TEST_FAILED:'Could not connect through the proxy. Check its endpoint and credentials.',
  FINGERPRINT_HOST_PROXY_REQUIRED:'The fingerprint needs to use this host’s required proxy.',
  ACCOUNT_IDENTITY_SEALED:'This page’s account identity is sealed.',
  CONTROL_EXPIRED:'Take control of this page to apply a fingerprint.',
  CONTROL_HELD:'Someone else controls this session.',
}

export let SessionFingerprints = ({ viewer, session, pane, lease }: { viewer: Awaited<ReturnType<typeof createViewer>>; session: string; pane: string; lease?: number }) => {
  let [catalog,setCatalog] = useState<FingerprintCatalog>(), [info,setInfo] = useState<FingerprintPane>()
  let [selected,setSelected] = useState<string>(), [name,setName] = useState('')
  let [busy,setBusy] = useState(false), [error,setError] = useState(''), [message,setMessage] = useState('')
  let [authorizing,setAuthorizing] = useState<FingerprintRecord>()
  let [edit,setEdit] = useState<{ base:FingerprintRecord; draft:FingerprintProfile }>()
  let [section,setSection] = useState<FingerprintSection>('device')
  let [reload,setReload] = useState(0), [loadError,setLoadError] = useState(false)
  useEffect(() => {
    let disposed = false, pending = false
    let update = async () => {
      if (pending) return
      pending = true
      try {
        let results = await Promise.allSettled([
          api('/api/fingerprints') as Promise<FingerprintCatalog>,
          viewer.request<FingerprintPane>({ type:'fingerprint.inspect',session,pane }),
        ])
        if (disposed) return
        if (results[0].status === 'fulfilled') setCatalog(results[0].value)
        if (results[1].status === 'fulfilled') setInfo(results[1].value)
        setLoadError(results.some(item => item.status === 'rejected'))
      } finally { pending = false }
    }
    void update()
    let timer = setInterval(() => void update(),5000)
    return () => { disposed = true; clearInterval(timer) }
  }, [viewer,session,pane,reload])

  let records = catalog?.records.filter(item => item.value) ?? []
  let applied = records.find(item => item.id === info?.applied?.id)
  let update = applied?.value && info?.applied && fingerprintSettings(applied.value) !== info.applied.settings ? applied : undefined
  let locked = info?.needsLock ? records.find(item => item.id === info.locked?.id) : undefined
  let saved = records.find(item => item.id === (selected ?? applied?.id ?? locked?.id))
  let execute = async (operation: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await operation() }
    catch (error) {
      let value = error as { code?:string; message?:string }
      setError(unavailable[value.code ?? ''] ?? value.message ?? 'Fingerprint operation failed.')
      setReload(value => value + 1)
    } finally { setBusy(false) }
  }
  let save = async (value: FingerprintProfile, revision: string | null) => {
    let draft = parseFingerprint(value)
    let { record } = await api('/api/fingerprints',{ id:draft.id,value:draft,revision }) as { record:FingerprintRecord }
    setCatalog(previous => previous && { ...previous,records:[...previous.records.filter(item => item.id !== record.id),record] })
    setSelected(record.id); setEdit(undefined); setName(''); setMessage('Fingerprint saved')
    setReload(value => value + 1)
  }
  let capture = (event: FormEvent) => {
    event.preventDefault()
    if (info) void execute(() => save({ ...info.current,name,id:`fingerprint_${crypto.randomUUID()}` },null))
  }
  let apply = (record?: FingerprintRecord, credentials?: { username:string; password:string }) => {
    if (!record?.value || lease === undefined) return
    let settings = fingerprintSettings(record.value)
    void execute(async () => {
      try {
        setInfo(await viewer.request<FingerprintPane>({ type:'fingerprint.apply',session,pane,generation:lease,fingerprint:record.id,settings,...(credentials ? { credentials } : {}) }))
      } catch (error) {
        if ((error as { code?:string }).code === 'FINGERPRINT_PROXY_CREDENTIALS_REQUIRED' && info?.proxyCredentialsAvailable) setAuthorizing(record)
        throw error
      }
      setAuthorizing(undefined)
      setMessage('Fingerprint applied')
    })
  }
  let authorize = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    let fields = new FormData(event.currentTarget)
    apply(authorizing,{ username:String(fields.get('username') ?? ''),password:String(fields.get('password') ?? '') })
    event.currentTarget.reset()
  }
  let enterCredentials = () => { setAuthorizing(saved); setError(''); setMessage('') }
  let cancelCredentials = () => { setAuthorizing(undefined); setError('') }
  let startEdit = () => {
    if (saved?.value) { setEdit({ base:saved,draft:structuredClone(saved.value) }); setSection('device'); setError('') }
  }
  return <details className={css.panel}>
    <summary>Fingerprint{applied?.value ? ` · ${applied.value.name}` : ''}{update && <span className={css.update}>Update available</span>}</summary>
    <div className={css.content}>
      {update && <div className={css.row}><button type="button" disabled={busy || lease === undefined} onClick={() => apply(update)}>Update and refresh</button></div>}
      {!update && locked && <div className={css.row}><span>Locked to {locked.value?.name}</span><button type="button" disabled={busy || lease === undefined} onClick={() => apply(locked)}>Apply and refresh</button></div>}
      {lease === undefined && (update || locked || saved) && <p>Take control to apply a fingerprint.</p>}
      {authorizing ? <form className={css.row} onSubmit={authorize} aria-label="Proxy credentials">
        <label>Proxy username<input required name="username" autoComplete="off" maxLength={4096} /></label>
        <label>Proxy password<input required name="password" type="password" autoComplete="new-password" maxLength={4096} /></label>
        <button disabled={busy || lease === undefined}>Save on host and apply</button><button type="button" onClick={cancelCredentials}>Cancel</button>
      </form> : edit ? <div className={css.editor}>
        <label>Name<input value={edit.draft.name} maxLength={120} onChange={event => setEdit({ ...edit,draft:{ ...edit.draft,name:event.target.value } })} /></label>
        <label>Settings<select value={section} onChange={event => setSection(event.target.value as FingerprintSection)}><option value="device">Device</option><option value="connection">Proxy</option><option value="viewport">Viewport</option></select></label>
        <FingerprintFields section={section} value={edit.draft} change={draft => setEdit({ ...edit,draft })} />
        <div className={css.row}><button type="button" disabled={busy} onClick={() => void execute(() => save(edit.draft,edit.base.revision))}>Save changes</button><button type="button" onClick={() => setEdit(undefined)}>Cancel</button>{error && <button type="button" disabled={busy} onClick={() => void execute(() => save({ ...edit.draft,id:`fingerprint_${crypto.randomUUID()}` },null))}>Save a copy</button>}</div>
      </div> : <>
        <div className={css.row}><label>Fingerprint profile<select value={saved?.id ?? ''} onChange={event => setSelected(event.target.value)}><option value="">Choose a profile</option>{records.map(item => <option key={item.id} value={item.id}>{item.value?.name}</option>)}</select></label><button type="button" disabled={!saved || busy || lease === undefined} onClick={() => apply(saved)}>Apply to page</button><button type="button" disabled={!saved || busy} onClick={startEdit}>Edit</button></div>
        {saved?.value?.proxy?.authenticated && info?.proxyCredentialsAvailable && lease !== undefined && <div className={css.row}><button type="button" disabled={busy} onClick={enterCredentials}>Enter proxy credentials</button></div>}
        <form className={css.row} onSubmit={capture}><label>Profile name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><button disabled={!info || !catalog || !name.trim() || busy}>Save current</button></form>
      </>}
      {(error || loadError) && <p role="alert">{error || 'Fingerprint settings are temporarily unavailable.'}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>
}
