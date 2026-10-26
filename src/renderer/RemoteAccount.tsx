import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AccountApi, BoxQuote, LiveView, ReferenceRates, RelayAccount, RelayBilling, RemoteComputer, RentedBox } from '../shared/remote-account'
import { estimateCurrency, priceEstimate, usdPrice } from '../shared/remote-prices'
import { recommendedBoxQuotes, sortedBoxQuotes } from '../shared/remote-box-quotes'
import { SelfHostedBox, useHostEnrollment } from './SelfHostedBox'
import styles from './RemoteAccount.module.css'

type Props = { api: AccountApi; visit: (url: string) => void | Promise<void>; signIn: () => void | Promise<void>; signOut?: () => void | Promise<void>; openBox?: (service: string) => Promise<void>; rent?: boolean; local?: boolean; view?: 'account' | 'relay' | 'boxes' }
export let RemoteAccount = ({ api, visit, signIn, signOut, openBox, rent = false, local = false, view = 'account' }: Props) => {
  let [account, setAccount] = useState<RelayAccount>(), [billing, setBilling] = useState<RelayBilling>()
  let [boxes, setBoxes] = useState<RentedBox[]>([]), [views, setViews] = useState<LiveView[]>([]), [computer, setComputer] = useState<RemoteComputer>()
  let [error, setError] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false)
  let [adding, setAdding] = useState(rent), [catalog, setCatalog] = useState<{ enabled: boolean; quotes: BoxQuote[] }>()
  let [boxKind, setBoxKind] = useState<'rental' | 'self-hosted'>('rental')
  let [deleting, setDeleting] = useState<RentedBox>(), [confirmation, setConfirmation] = useState('')
  let [rates, setRates] = useState<ReferenceRates>(), [selectedCurrency, setSelectedCurrency] = useState<string>()
  let pending = useRef(false)
  let report = (error: unknown) => { let value = message(error); setError(value); if (value === 'Sign in to remote') setAccount(undefined) }
  let currency = selectedCurrency ?? estimateCurrency(navigator.languages, rates)
  let money = (cents: number) => priceEstimate(cents, currency, rates, navigator.language)
  useEffect(() => {
    let active = true
    let load = () => { void api<ReferenceRates>('/api/billing/rates').then(value => { if (active) setRates(value) }).catch(() => { if (active) setRates(undefined) }) }
    load()
    let timer = setInterval(load, 3600000)
    return () => { active = false; clearInterval(timer) }
  }, [api])
  let refresh = async (active = () => true) => {
    let user = await api<RelayAccount>('/api/me')
    if (!active()) return
    setAccount(user)
    let [payment, rentals, streams, host] = await Promise.all([
      api<RelayBilling>('/api/billing/status'), view === 'relay' ? Promise.resolve([]) : api<RentedBox[]>('/api/rentals'), view === 'boxes' ? Promise.resolve([]) : api<LiveView[]>('/api/streams'),
      local ? api<RemoteComputer>('/local/state') : Promise.resolve(undefined),
    ])
    if (!active()) return
    setBilling(payment); setBoxes(rentals); setViews(streams); setComputer(host)
  }
  useEffect(() => {
    let active = true, loading = false
    let load = async () => {
      if (loading || pending.current) return
      loading = true
      try { await refresh(() => active) }
      catch (error) { if (active) report(error) }
      finally { loading = false; if (active) setLoaded(true) }
    }
    void load()
    let timer = setInterval(() => { void load() }, computer?.enabled && !computer.connected ? 2000 : 10000)
    return () => { active = false; clearInterval(timer) }
  }, [api, local, view, computer?.enabled, computer?.connected])
  useEffect(() => { setAdding(rent) }, [rent])
  let loadCatalog = async () => setCatalog(await api<{ enabled: boolean; quotes: BoxQuote[] }>('/api/rentals/catalog'))
  useEffect(() => {
    if (!adding || boxKind !== 'rental' || !account) return
    let active = true
    void api<{ enabled: boolean; quotes: BoxQuote[] }>('/api/rentals/catalog').then(value => { if (active) setCatalog(value) }).catch(error => { if (active) report(error) })
    return () => { active = false }
  }, [adding, boxKind, account?.owner, api])
  let act = async (operation: () => Promise<unknown>, refreshAfter = true) => {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try { await operation(); if (refreshAfter) await refresh() } catch (error) { report(error) }
    finally { pending.current = false; setBusy(false) }
  }
  let checkout = (path: string, body: unknown = {}) => act(async () => { let result = await api<{ url: string }>(path, body); await visit(result.url) })
  let host = useHostEnrollment(api, act, account?.owner)
  let activate = () => { void checkout('/api/billing/checkout') }
  let manage = () => { void checkout('/api/billing/portal') }
  let authenticate = () => { void act(async () => { await signIn() }) }
  let logout = () => { if (signOut) void act(async () => { await signOut() }, false) }
  let retry = () => { void act(async () => { if (adding && boxKind === 'rental') await loadCatalog() }) }
  let cancelRelay = () => { if (window.confirm('Cancel relay at the end of its paid period? Your boxes have separate subscriptions and will keep being charged.')) void act(() => api('/api/billing/cancel', {})) }
  let connect = (name: string) => { void act(() => api('/local/connect', { name })) }
  let disconnect = () => { if (window.confirm('Disconnect this computer from relay? Its browser sessions will keep running.')) void act(() => api('/local/disconnect', {})) }
  let rentBox = (body: unknown) => { void checkout('/api/rentals/checkout', body) }
  let disconnectView = (connection: string) => { void act(() => api('/api/streams/disconnect', { connection })) }
  let cancelBox = (box: RentedBox) => { if (window.confirm(`Cancel ${box.name}? The box and its files will be deleted at the end of its paid period.`)) void act(() => api(`/api/rentals/${box.id}/cancel`, {})) }
  let showDelete = (box: RentedBox) => { setConfirmation(''); setDeleting(box) }
  let deleteBox = (event: FormEvent) => { event.preventDefault(); if (deleting) void act(async () => { await api(`/api/rentals/${deleting.id}/delete`, { confirmName: confirmation }); setDeleting(undefined) }) }
  let add = () => { host.reset(); setAdding(true) }, hideAdd = () => setAdding(false), hideDelete = () => setDeleting(undefined)
  let chooseBoxKind = (event: ChangeEvent<HTMLInputElement>) => { setBoxKind(event.target.value as 'rental' | 'self-hosted'); setError('') }
  let changeCurrency = (event: ChangeEvent<HTMLSelectElement>) => setSelectedCurrency(event.target.value)
  let changeConfirmation = (event: ChangeEvent<HTMLInputElement>) => setConfirmation(event.target.value)
  let resumeCheckout = (url: string) => { void act(async () => { await visit(url) }) }
  let openService = openBox ? (service: string) => { void act(() => openBox(service)) } : undefined
  if (!loaded) return <p role="status">Loading account…</p>
  if (!account) return <section className={styles.account}><p>{error || 'Sign in to manage relay and boxes.'}</p><div className={styles.actions}><button onClick={authenticate} disabled={busy}>Sign in with Google</button><button onClick={retry} disabled={busy}>Retry</button></div></section>
  return <div className={styles.account} aria-label="Remote account" data-setting-id="remote-account">
    <div className={styles.heading}><span>{account.email || account.owner}</span>{!account.email && <button onClick={authenticate} disabled={busy}>Confirm billing email with Google</button>}{rates && (view !== 'boxes' || boxKind === 'rental') && <label className={styles.currency}>Estimates in <select value={currency} onChange={changeCurrency}>{Object.keys(rates.rates).sort().map(code => <option key={code} value={code}>{code}</option>)}</select></label>}{signOut && view === 'account' && <button onClick={logout} disabled={busy}>Sign out</button>}</div>
    {error && <div className={styles.error} role="alert">{error} <button onClick={retry} disabled={busy}>Retry</button></div>}
    {view !== 'boxes' && <section className={styles.section} aria-label="Relay"><div className={styles.heading}><h3>Relay</h3><span>{money(billing?.relay.monthlyCents ?? 1000)} / month</span></div>
      <p>Connect your computers and view two panes at once.</p>
      {billing?.relay.active ? <><p>{billing.relay.cancelRequested ? `Ends ${date(billing.relay.paidUntil)}` : billing.relay.recoveryDeadline ? `Update payment by ${date(billing.relay.recoveryDeadline)}` : 'Active'}</p><div className={styles.actions}><button onClick={manage} disabled={busy}>Manage billing</button>{!billing.relay.cancelRequested && <button onClick={cancelRelay} disabled={busy}>Cancel relay</button>}</div></> : <button onClick={activate} disabled={busy || !billing?.enabled}>{billing?.enabled ? 'Activate relay · $10/month' : 'Relay purchases coming soon'}</button>}
      {local && <ComputerConnection computer={computer} active={!!billing?.relay.active} busy={busy} connect={connect} disconnect={disconnect} />}
      {views.length > 0 && <div className={styles.views}><h4>Live views · {views.length}/{billing?.relay.maxStreams || 2}</h4>{views.map(view => <LiveViewRow key={view.connection} view={view} disconnect={disconnectView} busy={busy} />)}</div>}
    </section>}
    {view !== 'relay' && <section className={styles.section} aria-label="Rented boxes">
      <div className={styles.heading}><h3>{adding ? 'Add box' : boxes.length ? 'Your boxes' : 'Boxes'}</h3>{!adding && <button onClick={add} disabled={busy}>Add box</button>}</div>
      {adding && <fieldset className={styles.boxKinds} disabled={busy}><legend>Box type</legend><label><input type="radio" name="box-kind" value="rental" checked={boxKind === 'rental'} onChange={chooseBoxKind} />Rent a box</label><label><input type="radio" name="box-kind" value="self-hosted" checked={boxKind === 'self-hosted'} onChange={chooseBoxKind} />Self-hosted</label></fieldset>}
      {adding && boxKind === 'rental' && !billing?.relay.active && <div className={styles.actions}><span>Activate relay to rent a box.</span><button onClick={activate} disabled={busy || !billing?.enabled}>Activate relay · $10/month</button></div>}
      {adding && (boxKind === 'self-hosted' ? <><SelfHostedBox enrollment={host.enrollment} active={account.entitlement?.canStream ?? !!billing?.relay.active} busy={busy} create={host.create} revoke={host.revoke} close={hideAdd} />{local && <ComputerConnection computer={computer} active={account.entitlement?.canStream ?? !!billing?.relay.active} busy={busy} connect={connect} disconnect={disconnect} />}</> : catalog ? <RentBoxForm quotes={catalog.quotes} active={!!billing?.relay.active} enabled={catalog.enabled} busy={busy} submit={rentBox} close={hideAdd} money={money} /> : <p role="status">Loading box sizes…</p>)}
      {boxes.filter(box => !['failed', 'deleted'].includes(box.state)).map(box => <RentalCard key={box.id} box={box} cancel={cancelBox} remove={showDelete} visit={resumeCheckout} open={openService} busy={busy} money={money} />)}
      {deleting && <form className={styles.form} onSubmit={deleteBox}><h4>Delete {deleting.name}</h4><p>This deletes the box and all its files immediately and cancels its subscription, with no prorated refund.</p><label>Type {deleting.name} to delete<input value={confirmation} onChange={changeConfirmation} autoComplete="off" required /></label><div className={styles.actions}><button disabled={busy || confirmation !== deleting.name}>Delete box and files</button><button type="button" onClick={hideDelete}>Keep box</button></div></form>}
    </section>}
    {(view !== 'boxes' || boxKind === 'rental') && <p className={styles.billingNote}>Billed in USD. Your bank sets the conversion rate.{rates && currency !== 'USD' && <> Estimates use ECB rates from {rates.date}.</>}</p>}
  </div>
}
let ComputerConnection = ({ computer, active, busy, connect, disconnect }: { computer?: RemoteComputer; active: boolean; busy: boolean; connect: (name: string) => void; disconnect: () => void }) => {
  let [name, setName] = useState<string>()
  let submit = (event: FormEvent) => { event.preventDefault(); connect(name ?? computer?.name ?? '') }
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  return <div className={styles.computer}>{computer?.enabled ? <><p role="status" data-connected={!!computer.connected}>This computer: {computer.connected ? 'connected' : 'connecting'}{computer.service ? ` · ${computer.service}` : ''}</p><button onClick={disconnect} disabled={busy}>Disconnect computer</button></> : <form onSubmit={submit} className={styles.connectionForm}><label>Computer name<input value={name ?? computer?.name ?? ''} onChange={changeName} maxLength={64} required /></label><button disabled={busy || !active || !(name ?? computer?.name)?.trim()}>{busy ? 'Connecting…' : 'Connect this computer'}</button></form>}</div>
}
let message = (error: unknown) => (error instanceof Error ? error.message : 'Operation failed').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
let LiveViewRow = ({ view, disconnect, busy }: { view: LiveView; disconnect: (id: string) => void; busy: boolean }) => {
  let remove = () => disconnect(view.connection)
  return <div className={styles.heading}><span>{view.pane}</span><button onClick={remove} disabled={busy}>Disconnect view</button></div>
}
let RentalCard = ({ box, cancel, remove, visit, open, busy, money }: { box: RentedBox; cancel: (box: RentedBox) => void; remove: (box: RentedBox) => void; visit: (url: string) => void; open?: (service: string) => void; busy: boolean; money: (cents: number) => string }) => {
  let status = ({ checkout: 'Waiting for payment', provisioning: 'Installing and connecting…', ready: 'Running', deleting: 'Deleting box and files…' } as Record<string, string>)[box.state] ?? box.state
  let resume = () => { if (box.checkoutUrl) visit(box.checkoutUrl) }, cancelBox = () => cancel(box), deleteBox = () => remove(box), openBox = () => { if (box.service) open?.(box.service) }
  return <div className={styles.box}><div className={styles.heading}><strong>{box.name}</strong><span>{money(box.quote.monthlyCents)} / month</span></div><p>{box.quote.memoryGb} GB · {box.quote.regionName} · <span role="status">{status}</span></p>
    {box.service && <p>{box.service}</p>}{box.ipv4 && <p><code>ssh bmux@{box.ipv4}</code></p>}{box.trafficPaused && <p>Network paused until the next provider traffic month.</p>}{box.recoveryDeadline && <p>Update payment by {date(box.recoveryDeadline)} to keep this box.</p>}{box.cancelRequested && <p>Files and box scheduled for deletion {date(box.deleteAt || box.paidUntil)}.</p>}{box.needsAttention && <p>An operation is being retried. Status updates automatically.</p>}
    <div className={styles.actions}>{box.state === 'ready' && box.service && open && <button onClick={openBox} disabled={busy}>Open box</button>}{box.state === 'checkout' && box.checkoutUrl && <button onClick={resume} disabled={busy}>Resume checkout</button>}{!box.cancelRequested && box.paidUntil && <button onClick={cancelBox} disabled={busy}>Cancel at period end</button>}<button onClick={deleteBox} disabled={busy || box.state === 'deleting'}>Delete now</button></div>
  </div>
}
let RentBoxForm = ({ quotes, active, enabled, busy, submit, close, money }: { quotes: BoxQuote[]; active: boolean; enabled: boolean; busy: boolean; submit: (body: unknown) => void; close: () => void; money: (cents: number) => string }) => {
  let recommended = recommendedBoxQuotes(quotes, Intl.DateTimeFormat().resolvedOptions().timeZone)
  let [name, setName] = useState('My box'), [selected, setSelected] = useState(recommended[0]?.id ?? ''), [keys, setKeys] = useState(''), [accepted, setAccepted] = useState(false), [customize, setCustomize] = useState(false)
  let order = useRef<string | undefined>(undefined), quote = quotes.find(quote => quote.id === selected)
  let edit = (change: () => void) => { order.current = undefined; change() }
  let choose = (id: string) => edit(() => { setSelected(id); setAccepted(false) })
  let changeName = (event: ChangeEvent<HTMLInputElement>) => edit(() => setName(event.target.value))
  let changeKeys = (value: string) => edit(() => setKeys(value))
  let changeAccepted = (event: ChangeEvent<HTMLInputElement>) => setAccepted(event.target.checked)
  let toggleCustomize = () => setCustomize(!customize)
  let rentBox = (event: FormEvent) => {
    event.preventDefault()
    if (!quote || !accepted || !name.trim() || busy || !enabled || !active) return
    order.current ??= crypto.randomUUID()
    submit({ requestId: order.current, quoteId: quote.id, name: name.trim(), sshKeys: keys.split('\n').map(key => key.trim()).filter(Boolean), acceptedTerms: accepted })
  }
  return <form className={styles.form} onSubmit={rentBox} aria-label="Rent a box">
    {!enabled && <p>Rental checkout is currently unavailable.</p>}
    {!quotes.length ? <p>No boxes are available right now.</p> : <>
      {!customize ? <RecommendedBoxes quotes={recommended} selected={selected} choose={choose} busy={busy} money={money} /> : <BoxOptions quotes={quotes} selected={selected} choose={choose} busy={busy} money={money} keys={keys} changeKeys={changeKeys} />}
      <button type="button" className={styles.disclosure} aria-expanded={customize} onClick={toggleCustomize}>{customize ? 'Show recommendations' : 'All sizes and regions'}</button>
      {quote && <p role="status">Selected: {quote.memoryGb} GB · {quote.regionName} · {money(quote.monthlyCents)} / month</p>}
      <label>Box name<input value={name} onChange={changeName} maxLength={64} required disabled={busy} /></label>
      <details className={styles.terms}><summary>Rental and deletion terms</summary><p>bmux, Node, Python and Git are installed. Files persist in <code>/home/bmux/workspace</code>. Bring your own agent tools and credentials.</p><p>Price includes IPv4 and our 20% service fee. Tax is added at checkout. Relay is billed separately. Canceling relay keeps your box running and billed. Cancellation deletes the box and files at the end of its paid period; immediate deletion has no prorated refund. Backups and resizing are not included.</p>{quote && <p>{(quote.trafficBytes / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 })} TB outgoing traffic per provider month. Networking pauses at 90% until the next provider traffic month.</p>}</details>
      <label className={styles.checkbox}><input type="checkbox" checked={accepted} onChange={changeAccepted} required disabled={busy} /><span>I accept the <a href="https://bmux.cc/terms" target="_blank" rel="noreferrer">rental and deletion terms</a>.</span></label>
      <button disabled={busy || !enabled || !accepted || !quote || !active || !name.trim()}>{busy ? 'Opening checkout…' : `Continue to checkout${quote ? ` · ${usdPrice(quote.monthlyCents, navigator.language)}/month` : ''}`}</button>
    </>}
    <button type="button" onClick={close} disabled={busy}>Close</button>
  </form>
}
let BoxOptions = ({ quotes, selected, choose, busy, money, keys, changeKeys }: { quotes: BoxQuote[]; selected: string; choose: (id: string) => void; busy: boolean; money: (cents: number) => string; keys: string; changeKeys: (value: string) => void }) => {
  let [region, setRegion] = useState('all')
  let sorted = sortedBoxQuotes(quotes), regions = [...new Set(sorted.map(quote => quote.region))]
  let changeRegion = (event: ChangeEvent<HTMLSelectElement>) => { let region = event.target.value; setRegion(region); if (region !== 'all' && quotes.find(quote => quote.id === selected)?.region !== region) choose(sorted.find(quote => quote.region === region)!.id) }
  let changeQuote = (event: ChangeEvent<HTMLSelectElement>) => choose(event.target.value)
  let editKeys = (event: ChangeEvent<HTMLTextAreaElement>) => changeKeys(event.target.value)
  return <div className={styles.customize}><label>Region<select value={region} onChange={changeRegion} disabled={busy}><option value="all">All regions</option>{regions.map(region => <option key={region} value={region}>{sorted.find(quote => quote.region === region)!.regionName}</option>)}</select></label><label>Size and region<select value={selected} onChange={changeQuote} disabled={busy} required><option value="" disabled>Choose a box</option>{sorted.filter(candidate => region === 'all' || candidate.region === region).map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.memoryGb} GB · {candidate.regionName} · {money(candidate.monthlyCents)}/month</option>)}</select></label><label>SSH public keys (optional)<textarea value={keys} onChange={editKeys} placeholder="ssh-ed25519 …" rows={2} disabled={busy} /></label></div>
}
let RecommendedBoxes = ({ quotes, selected, choose, busy, money }: { quotes: BoxQuote[]; selected: string; choose: (id: string) => void; busy: boolean; money: (cents: number) => string }) => <div><h4>Recommended near you</h4><div className={styles.quoteGrid} role="radiogroup" aria-label="Recommended boxes">{quotes.map(quote => <BoxChoice key={quote.id} quote={quote} selected={quote.id === selected} choose={choose} busy={busy} money={money} />)}</div></div>
let BoxChoice = ({ quote, selected, choose, busy, money }: { quote: BoxQuote; selected: boolean; choose: (id: string) => void; busy: boolean; money: (cents: number) => string }) => {
  let change = () => choose(quote.id)
  return <label className={styles.quote} data-selected={selected}><input type="radio" name="box-quote" value={quote.id} checked={selected} onChange={change} disabled={busy} /><strong>{quote.memoryGb} GB · {quote.regionName}</strong><span>{quote.cores} vCPU · {quote.diskGb} GB disk</span><span>{money(quote.monthlyCents)} / month</span></label>
}
let date = (value?: string) => value ? new Date(value).toLocaleDateString() : ''
