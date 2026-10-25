import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Host } from './client'
import type { RemotePane, RemoteSession, RemoteWindow } from '../../src/shared/remote-sessions'
import { activityLabel } from '../../src/shared/pane-activity'
import { remoteMachineName, remoteWindowName } from '../../src/shared/remote-tree'
import { RemoteMachineHeading } from '../../src/renderer/RemoteMachine'
import css from './SessionTree.module.css'

let Chevron = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
let PageIcon = () => <svg className={css.pageIcon} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c4 4 4 10 0 14-4-4-4-10 0-14" /></svg>
let Activity = ({ when, now }: { when?: number; now: number }) => when ? <time className={css.activity} dateTime={new Date(when).toISOString()} title={'Last used ' + new Date(when).toLocaleString()}>{activityLabel(when, now)}</time> : null

let Branch = ({ name, label, active, open, children, activity, child }: { name: string; label: string; active?: boolean; open: () => void; children: ReactNode; activity?: ReactNode; child?: boolean }) => {
  let [expanded, setExpanded] = useState(true), ref = useRef<HTMLDivElement>(null)
  let toggle = (next = !expanded) => { setExpanded(next); ref.current?.querySelector<HTMLButtonElement>('[data-tree-row]')?.focus({ preventScroll: true }) }
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || !['h', 'l', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation(); toggle(event.key === 'ArrowRight' ? !expanded : event.key === 'l')
  }
  return <div ref={ref} className={child ? css.child : undefined} onKeyDown={keys}>
    <div className={css.heading} onContextMenu={event => { event.preventDefault(); toggle() }}>
      <button type="button" className={css.toggle} aria-label={(expanded ? 'Collapse ' : 'Expand ') + label[0].toLowerCase() + label.slice(1)} aria-expanded={expanded} onClick={() => toggle()}><Chevron /></button>
      <button type="button" data-tree-row className={css.row} aria-label={'Open ' + name} aria-current={active || undefined} onClick={open}>{child && <PageIcon />}<span className={css.name}>{name}</span>{activity}</button>
    </div>
    {expanded && <div className={css.children} role="group" aria-label={label}>{children}</div>}
  </div>
}
let PageRow = ({ pane, active, open, now }: { pane: RemotePane; active: boolean; open: () => void; now: number }) => <div className={css.child}><button type="button" data-tree-row className={css.row} aria-label={'Open ' + (pane.title || 'Blank page')} aria-current={active || undefined} onClick={open} title={pane.agentPurpose}><PageIcon /><span className={css.name}>{pane.title || 'Blank page'}</span><Activity when={pane.lastActivityAt} now={now} /></button></div>
let WindowRow = ({ window, pane, active, open, now }: { window: RemoteWindow; pane?: string; active: boolean; open: (pane: string) => void; now: number }) => {
  let selected = window.panes.find(item => item.id === pane) ?? window.panes[0], name = remoteWindowName(window, pane)
  let activity = <Activity when={window.lastActivityAt ?? selected?.lastActivityAt} now={now} />
  if (!selected) return null
  if (window.panes.length === 1) return <div className={css.child}><button type="button" data-tree-row className={css.row} aria-label={'Open ' + name} aria-current={active || undefined} onClick={() => open(selected.id)}><PageIcon /><span className={css.name}>{name}</span>{activity}</button></div>
  return <Branch child name={name} label={'Pages in ' + name} active={active} activity={activity} open={() => open(selected.id)}>{window.panes.map(item => <PageRow key={item.id} pane={item} active={active && item.id === pane} open={() => open(item.id)} now={now} />)}</Branch>
}
let Session = ({ host, session, selected, pane, select, now }: { host: Host; session: RemoteSession; selected: boolean; pane?: string; select: (host: Host, session: RemoteSession, pane?: string) => void; now: number }) => <Branch name={session.name} label={'Windows in ' + session.name} active={selected} activity={<Activity when={session.lastActivityAt} now={now} />} open={() => select(host, session)}>
  {session.windows?.length ? session.windows.map(window => <WindowRow key={window.id} window={window} pane={selected ? pane : undefined} active={selected && window.panes.some(item => item.id === pane)} open={pane => select(host, session, pane)} now={now} />) : session.panes.map(item => <PageRow key={item.id} pane={item} active={selected && item.id === pane} open={() => select(host, session, item.id)} now={now} />)}
</Branch>

export let SessionTree = ({ hosts, selected, pane, select, details, color }: { hosts: Host[]; selected: string; pane?: string; select: (host: Host, session: RemoteSession, pane?: string) => void; details: (host: Host) => void; color: (id: string) => string }) => {
  let [collapsed, setCollapsed] = useState<string[]>([]), [now, setNow] = useState(Date.now)
  useEffect(() => { let timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  let keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey || !['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    let rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tree-row], [data-machine-details]')], index = rows.indexOf(event.target as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    let next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (['j', 'ArrowDown'].includes(event.key) ? 1 : -1)))
    rows[next]?.focus(); rows[next]?.scrollIntoView({ block: 'nearest' })
  }
  return <div className={css.tree} onKeyDown={keys} aria-label="Remote sessions">
    {hosts.map(host => {
      let expanded = !collapsed.includes(host.id), name = remoteMachineName(host, hosts)
      let toggle = () => { setCollapsed(values => expanded ? [...values, host.id] : values.filter(id => id !== host.id)); document.querySelector<HTMLButtonElement>(`[data-machine-details="${CSS.escape(host.id)}"]`)?.focus({ preventScroll: true }) }
      let machineKeys = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target instanceof HTMLElement && !event.target.closest('[data-machine-details], [data-machine-toggle]')) return
        if (event.metaKey || event.ctrlKey || event.altKey || !['h', 'l', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        let next = event.key === 'ArrowRight' ? !expanded : event.key === 'l'
        setCollapsed(values => next ? values.filter(id => id !== host.id) : [...values.filter(id => id !== host.id), host.id])
      }
      return <div key={host.id} className={css.machine} onKeyDown={machineKeys}>
        <RemoteMachineHeading host={host} name={name} color={color(host.id)} expanded={expanded} toggle={toggle} details={() => details(host)} chevron={<Chevron />} />
        {expanded && <div className={css.machineSessions} role="group" aria-label={'Sessions on ' + name}>{host.sessions.map(session => <Session key={session.id} host={host} session={session} selected={selected === host.id + ':' + session.id} pane={pane} select={select} now={now} />)}{host.sessions.length === 0 && <p>No sessions.</p>}</div>}
      </div>
    })}
  </div>
}
