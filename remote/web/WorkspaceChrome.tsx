import { useState } from 'react'
import type { ReactNode } from 'react'
import css from './WorkspaceChrome.module.css'

let GoogleIcon = () => <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M44 24c0-1.4-.1-2.7-.4-4H24v8h11.2A11.9 11.9 0 0 1 24 36a12 12 0 1 1 8.5-20.5l6-6A20 20 0 1 0 44 24Z" /></svg>
export let WorkspaceHeader = ({ demo, checking, signIn, ready, account, home }: { demo: boolean; checking?: boolean; signIn?: () => void; ready?: boolean; account?: ReactNode; home?: () => void }) => <header className={css.header}>
  {home ? <button className={css.brand} onClick={home} aria-label="BMUX home"><Brand /></button> : <a className={css.brand} href="/" aria-label="BMUX home"><Brand /></a>}
  <span className={css.label}>Remote</span>{demo && <span className={css.demo}>Demo</span>}
  <div className={css.actions}>{!checking && signIn && <button className={css.signIn} onClick={signIn} disabled={!ready}><GoogleIcon />Sign in with Google</button>}{account}</div>
</header>
let Brand = () => <><img src="https://cdn.digthree.tonis.dev/bmux/website-ca1a3c8712d7/icon-512.png" alt="" width="28" height="28" />bmux</>
export let WorkspaceProfile = () => <a href="/?view=account" className={css.profile} aria-label="Account"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg></a>
export let WorkspaceNavigation = ({ active, nodes, accounts }: { active: 'nodes' | 'accounts'; nodes?: ReactNode; accounts?: ReactNode }) => <nav className={css.navigation} aria-label="Workspace views">
  <WorkspaceSection title="Nodes" href="/" active={active === 'nodes'}>{nodes ?? <a className={css.childLink} href="/">Open nodes</a>}</WorkspaceSection>
  <WorkspaceSection title="Accounts" href="/accounts" active={active === 'accounts'}>{accounts ?? <a className={css.childLink} href="/accounts">Open accounts</a>}</WorkspaceSection>
</nav>
let WorkspaceSection = ({ title, href, active, children }: { title: string; href: string; active: boolean; children: ReactNode }) => {
  let [expanded, setExpanded] = useState(active)
  return <section className={css.section} aria-label={title + ' view'}><div className={css.sectionHeading}>
    <button className={css.toggle} aria-label={(expanded ? 'Collapse ' : 'Expand ') + title.toLowerCase() + ' view'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : undefined }}><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    <a href={href} aria-current={active ? 'page' : undefined} onClick={event => { if (active) { event.preventDefault(); setExpanded(!expanded) } }}>{title}</a>
  </div>{expanded && <div className={css.sectionContent}>{children}</div>}</section>
}
