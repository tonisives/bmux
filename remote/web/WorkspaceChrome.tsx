import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import css from './WorkspaceChrome.module.css'

export type WorkspaceView = 'nodes' | 'accounts'
export let WorkspaceViewContext = createContext<{ active: WorkspaceView; select: (view: WorkspaceView) => void; account: () => void } | undefined>(undefined)

let GoogleIcon = () => <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M44 24c0-1.4-.1-2.7-.4-4H24v8h11.2A11.9 11.9 0 0 1 24 36a12 12 0 1 1 8.5-20.5l6-6A20 20 0 1 0 44 24Z" /></svg>
export let WorkspaceHeader = ({ demo, checking, signIn, ready, account, home }: { demo: boolean; checking?: boolean; signIn?: () => void; ready?: boolean; account?: ReactNode; home?: () => void }) => {
  let workspace = useContext(WorkspaceViewContext), goHome = home ?? (workspace ? () => workspace.select('nodes') : undefined)
  return <header className={css.header}>
    {goHome ? <button className={css.brand} onClick={goHome} aria-label="BMUX home"><Brand /></button> : <a className={css.brand} href="/" aria-label="BMUX home"><Brand /></a>}
    <span className={css.label}>Remote</span>{demo && <span className={css.demo}>Demo</span>}
    <div className={css.actions}>{!checking && signIn && <button className={css.signIn} onClick={signIn} disabled={!ready}><GoogleIcon />Sign in with Google</button>}{account}</div>
  </header>
}
let Brand = () => <><img src="https://cdn.digthree.tonis.dev/bmux/website-ca1a3c8712d7/icon-512.png" alt="" width="28" height="28" />bmux</>
export let WorkspaceProfile = () => {
  let workspace = useContext(WorkspaceViewContext)
  let icon = <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>
  return workspace ? <button className={css.profile} onClick={workspace.account} aria-label="Account">{icon}</button> : <a href="/?view=account" className={css.profile} aria-label="Account">{icon}</a>
}
export let WorkspaceNavigation = ({ active, nodes, accounts, onActive }: { active: WorkspaceView; nodes?: ReactNode; accounts?: ReactNode; onActive?: () => void }) => {
  let workspace = useContext(WorkspaceViewContext)
  let views: WorkspaceView[] = workspace ? ['nodes', 'accounts'] : [active]
  return <nav className={css.navigation} aria-label="Workspace views">{views.map(view => {
    let selected = active === view, title = view === 'nodes' ? 'Nodes' : 'Accounts'
    return <section key={view} className={css.section} data-active={selected} aria-label={title + ' view'}>
      <button type="button" className={css.switchView} aria-expanded={selected} onClick={() => { if (selected) onActive?.(); else workspace?.select(view) }}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={{ transform: selected ? 'rotate(90deg)' : undefined }}><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>{title}
      </button>
      {selected && <div className={css.sectionContent} data-workspace-content>{view === 'nodes' ? nodes : accounts}</div>}
    </section>
  })}</nav>
}
