import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import type { AccountApi, BoxQuote, LiveView, ReferenceRates, RelayAccount, RelayBilling, RentedBox } from '../shared/remote-account'
import { estimateCurrency, priceEstimate, usdPrice } from '../shared/remote-prices'
import styles from './RemoteAccount.module.css'

type Props = { api: AccountApi; visit: (url: string) => void | Promise<void>; signIn: () => void; rent?: boolean; local?: boolean }
export let RemoteAccount = ({ api, visit, signIn, rent = false, local = false }: Props) => {
  let [account, setAccount] = useState<RelayAccount>()
  let [billing, setBilling] = useState<RelayBilling>()
  let [boxes, setBoxes] = useState<RentedBox[]>([])
  let [views, setViews] = useState<LiveView[]>([])
  let [computer, setComputer] = useState<{ enabled: boolean; connected?: boolean; service?: string }>()
  let [error, setError] = useState(''), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false)
  let [adding, setAdding] = useState(rent), [quotes, setQuotes] = useState<BoxQuote[]>([]), [rentalsEnabled, setRentalsEnabled] = useState(false)
  let [deleting, setDeleting] = useState<RentedBox>(), [confirmation, setConfirmation] = useState('')
  let [rates, setRates] = useState<ReferenceRates>(), [selectedCurrency, setSelectedCurrency] = useState<string>()
  let currency = selectedCurrency ?? estimateCurrency(navigator.languages,rates)
  let money = (cents: number) => priceEstimate(cents,currency,rates,navigator.language)
  useEffect(() => {
    let active = true
    let load = () => { void api<ReferenceRates>('/api/billing/rates').then(value => { if (active) setRates(value) }).catch(() => { if (active) setRates(undefined) }) }
    load()
    let timer = setInterval(load,3600000)
    return () => { active = false; clearInterval(timer) }
  }, [api])
  let refresh = async () => {
    let [user, payment, rentals, streams, host] = await Promise.all([
      api<RelayAccount>('/api/me'), api<RelayBilling>('/api/billing/status'), api<RentedBox[]>('/api/rentals'), api<LiveView[]>('/api/streams'),
      local ? api<{ enabled: boolean; connected?: boolean; service?: string }>('/local/state') : Promise.resolve(undefined),
    ])
    setAccount(user); setBilling(payment); setBoxes(rentals); setViews(streams); setComputer(host)
  }
  useEffect(() => {
    let active = true
    let load = async () => { try { await refresh(); if (active) setError('') } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Account unavailable') } finally { if (active) setLoaded(true) } }
    void load()
    let timer = setInterval(() => { void load() }, computer?.enabled && !computer.connected ? 2000 : 10000)
    return () => { active = false; clearInterval(timer) }
  }, [api, local, computer?.enabled, computer?.connected])
  useEffect(() => { setAdding(rent) }, [rent])
  useEffect(() => {
    if (!adding || !account) return
    let active = true
    void api<{ enabled: boolean; quotes: BoxQuote[] }>('/api/rentals/catalog').then(result => { if (!active) return; setRentalsEnabled(result.enabled); setQuotes(result.quotes) }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Box sizes unavailable') })
    return () => { active = false }
  }, [adding, account?.owner, api])
  let act = async (operation: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await operation(); await refresh() } catch (error) { setError(error instanceof Error ? error.message : 'Operation failed') } finally { setBusy(false) } }
  let checkout = (path: string, body: unknown = {}) => act(async () => { let result = await api<{ url: string }>(path,body); await visit(result.url) })
  let activate = () => { void checkout('/api/billing/checkout') }
  let manage = () => { void checkout('/api/billing/portal') }
  let cancelRelay = () => { if (window.confirm('Cancel relay at the end of its paid period? Your boxes have separate subscriptions and will keep being charged.')) void act(() => api('/api/billing/cancel',{})) }
  let connect = () => { void act(() => api('/local/connect',{})) }
  let disconnect = () => { if (window.confirm('Disconnect this computer from relay? Its browser sessions will keep running.')) void act(() => api('/local/disconnect',{})) }
  let add = () => setAdding(true)
  let hideAdd = () => setAdding(false)
  let rentBox = (body: unknown) => { void checkout('/api/rentals/checkout',body) }
  let disconnectView = (connection: string) => { void act(() => api('/api/streams/disconnect',{ connection })) }
  let cancelBox = (box: RentedBox) => { if (window.confirm(`Cancel ${box.name}? The box and its files will be deleted at the end of its paid period.`)) void act(() => api(`/api/rentals/${box.id}/cancel`,{})) }
  let showDelete = (box: RentedBox) => { setConfirmation(''); setDeleting(box) }
  let hideDelete = () => setDeleting(undefined)
  let deleteBox = (event: FormEvent) => { event.preventDefault(); if (deleting) void act(async () => { await api(`/api/rentals/${deleting.id}/delete`,{ confirmName:confirmation }); setDeleting(undefined) }) }
  let changeConfirmation = (event: ChangeEvent<HTMLInputElement>) => setConfirmation(event.target.value)
  let changeCurrency = (event: ChangeEvent<HTMLSelectElement>) => setSelectedCurrency(event.target.value)
  if (!loaded) return <p role="status">Loading account…</p>
  if (!account) return <section className={styles.account}><p>{error || 'Sign in to manage relay and boxes.'}</p><button onClick={signIn}>Sign in with Google</button></section>
  return <div className={styles.account} aria-label="Remote account" data-setting-id="remote-account">
    <p>{account.email || account.owner}</p>
    {!account.email && <button onClick={signIn}>Confirm billing email with Google</button>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {rates && <label className={styles.currency}>Estimates in <select value={currency} onChange={changeCurrency}>{Object.keys(rates.rates).sort().map(code => <option key={code} value={code}>{code}</option>)}</select></label>}
    <p>Billed in USD. Your bank sets the conversion rate.{rates && currency !== 'USD' && <> Estimates use ECB rates from {rates.date}.</>}</p>
    <section className={styles.section} aria-label="Relay"><div className={styles.heading}><h3>Relay</h3><span>{money(billing?.relay.monthlyCents ?? 1000)} / month</span></div>
      <p>Connect your computers and view two panes at once across your account.</p>
      {billing?.relay.active ? <><p>{billing.relay.cancelRequested ? `Ends ${date(billing.relay.paidUntil)}` : billing.relay.recoveryDeadline ? `Update payment by ${date(billing.relay.recoveryDeadline)}` : 'Active'}</p><div className={styles.actions}><button onClick={manage} disabled={busy}>Manage billing</button>{!billing.relay.cancelRequested && <button onClick={cancelRelay} disabled={busy}>Cancel relay</button>}</div></> : <button onClick={activate} disabled={busy || !billing?.enabled}>{billing?.enabled ? 'Activate relay · $10/month' : 'Relay purchases coming soon'}</button>}
      {local && <div className={styles.computer}>{computer?.enabled ? <><p>This computer: {computer.connected ? 'connected' : 'connecting'}{computer.service ? ` · ${computer.service}` : ''}</p><button onClick={disconnect} disabled={busy}>Disconnect computer</button></> : <button onClick={connect} disabled={busy || !billing?.relay.active}>Connect this computer</button>}</div>}
      {views.length > 0 && <div className={styles.views}><h4>Live views · {views.length}/{billing?.relay.maxStreams || 2}</h4>{views.map(view => <LiveViewRow key={view.connection} view={view} disconnect={disconnectView} busy={busy} />)}</div>}
    </section>
    <section className={styles.section} aria-label="Rented boxes"><div className={styles.heading}><h3>Boxes</h3><button onClick={add} disabled={busy}>Add box</button></div><p>Each box has a separate monthly subscription. Canceling relay keeps your boxes running and billed.</p>
      {boxes.filter(box => !['failed','deleted'].includes(box.state)).map(box => <RentalCard key={box.id} box={box} cancel={cancelBox} remove={showDelete} busy={busy} money={money} />)}
      {adding && <RentBoxForm quotes={quotes} active={!!billing?.relay.active} enabled={rentalsEnabled} busy={busy} submit={rentBox} close={hideAdd} money={money} />}
      {deleting && <form className={styles.form} onSubmit={deleteBox}><h4>Delete {deleting.name}</h4><p>This deletes the box and all its files immediately, cancels its subscription, and gives no prorated refund. Relay stays active.</p><label>Type {deleting.name} to delete<input value={confirmation} onChange={changeConfirmation} autoComplete="off" required /></label><div className={styles.actions}><button disabled={busy || confirmation !== deleting.name}>Delete box and files</button><button type="button" onClick={hideDelete}>Keep box</button></div></form>}
    </section>
  </div>
}
let LiveViewRow = ({ view, disconnect, busy }: { view: LiveView; disconnect: (id: string) => void; busy: boolean }) => {
  let remove = () => disconnect(view.connection)
  return <div className={styles.heading}><span>{view.pane}</span><button onClick={remove} disabled={busy}>Disconnect view</button></div>
}
let RentalCard = ({ box, cancel, remove, busy, money }: { box: RentedBox; cancel: (box: RentedBox) => void; remove: (box: RentedBox) => void; busy: boolean; money: (cents: number) => string }) => {
  let cancelBox = () => cancel(box), deleteBox = () => remove(box)
  return <div className={styles.box}><div className={styles.heading}><strong>{box.name}</strong><span>{money(box.quote.monthlyCents)} / month</span></div><p>{box.quote.memoryGb} GB · {box.quote.regionName} · {box.state === 'ready' ? 'Running' : box.state}</p>
    {box.ipv4 && <p><code>ssh bmux@{box.ipv4}</code></p>}{box.trafficPaused && <p>Network paused until the next provider traffic month.</p>}{box.recoveryDeadline && <p>Update payment by {date(box.recoveryDeadline)} to keep this box.</p>}{box.cancelRequested && <p>Files and box scheduled for deletion {date(box.deleteAt || box.paidUntil)}.</p>}
    <div className={styles.actions}>{!box.cancelRequested && box.paidUntil && <button onClick={cancelBox} disabled={busy}>Cancel at period end</button>}<button onClick={deleteBox} disabled={busy || box.state === 'deleting'}>Delete now</button></div>
  </div>
}
let RentBoxForm = ({ quotes, active, enabled, busy, submit, close, money }: { quotes: BoxQuote[]; active: boolean; enabled: boolean; busy: boolean; submit: (body: unknown) => void; close: () => void; money: (cents: number) => string }) => {
  let [name, setName] = useState('My box'), [selected, setSelected] = useState(''), [keys, setKeys] = useState(''), [accepted, setAccepted] = useState(false)
  let order = useRef(crypto.randomUUID()), quote = quotes.find(quote => quote.id === selected) ?? quotes[0]
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let changeQuote = (event: ChangeEvent<HTMLSelectElement>) => setSelected(event.target.value)
  let changeKeys = (event: ChangeEvent<HTMLTextAreaElement>) => setKeys(event.target.value)
  let changeAccepted = (event: ChangeEvent<HTMLInputElement>) => setAccepted(event.target.checked)
  let rentBox = (event: FormEvent) => { event.preventDefault(); submit({ requestId:order.current,quoteId:quote?.id,name:name.trim(),sshKeys:keys.split('\n').map(key => key.trim()).filter(Boolean),acceptedTerms:accepted }) }
  return <form className={styles.form} onSubmit={rentBox} aria-label="Rent a box"><div className={styles.heading}><h4>Rent a box</h4><button type="button" onClick={close}>Close</button></div>
    {!active && <p>Activate relay first, then choose your box. The two subscriptions are charged separately.</p>}
    <label>Box name<input value={name} onChange={changeName} maxLength={64} required /></label>
    <label>Size and region<select value={quote?.id ?? ''} onChange={changeQuote} required><option value="" disabled>Choose a box</option>{quotes.map(quote => <option key={quote.id} value={quote.id}>{quote.memoryGb} GB · {quote.regionName} · {money(quote.monthlyCents)}/month</option>)}</select></label>
    {quote && <p>{quote.cores} shared vCPUs · {quote.diskGb} GB disk · {(quote.trafficBytes / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2 })} TB outgoing traffic per provider month. Price includes IPv4 and our 20% service fee. Tax is added at checkout.</p>}
    <label>SSH public keys (optional)<textarea value={keys} onChange={changeKeys} placeholder="ssh-ed25519 …" rows={2} /></label>
    <p>bmux, Node, Python and Git are installed. Files persist in <code>/home/bmux/workspace</code>. Bring your own agent tools and credentials. Backups and resizing are not included.</p>
    <label className={styles.checkbox}><input type="checkbox" checked={accepted} onChange={changeAccepted} required /><span>I agree to the <a href="https://bmux.cc/terms" target="_blank" rel="noreferrer">terms</a>. Cancellation deletes this box and its files at the end of the paid period. Networking pauses at 90% of included traffic.</span></label>
    <button disabled={busy || !accepted || !quote || !enabled || !active}>{enabled ? `Continue to checkout${quote ? ` · ${usdPrice(quote.monthlyCents,navigator.language)}/month` : ''}` : 'Box rentals coming soon'}</button>
  </form>
}
let date = (value?: string) => value ? new Date(value).toLocaleDateString() : ''
