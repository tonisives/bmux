import { useCallback, useMemo, useState } from 'react'
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react'
import type { RemoteHost } from '../shared/remote-sessions'
import { BackButton } from './PanelHeader'
import type { PanelBack } from './PanelHeader'
import css from './RemoteMachine.module.css'
import { remoteMachineColor, remoteMachineName, remoteMachinePalette as palette } from '../shared/remote-tree'

export { remoteMachineName }
export let useRemoteMachines = (hosts: RemoteHost[], ref: RefObject<HTMLElement | null>) => {
  let [selected, select] = useState<string>()
  let colors = useRemoteMachineColors(hosts)
  let close = useCallback(() => { select(undefined); requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-machine-details="${CSS.escape(selected ?? '')}"]`)?.focus({ preventScroll: true })) }, [selected])
  let back = useMemo(() => ({ label: 'Back to preview', run: close }), [close])
  return { selected: hosts.find(host => host.id === selected), select, back, ...colors }
}
export let useRemoteMachineColors = (hosts: RemoteHost[]) => {
  let [colors, setColors] = useState<Record<string, string>>(() => {
    try { let saved = JSON.parse(localStorage.getItem('remote-machine-colors') ?? '{}'); return Object.fromEntries(Object.entries(saved).filter(([id, color]) => id && typeof color === 'string' && /^#[a-f0-9]{6}$/i.test(color))) as Record<string, string> } catch { return {} }
  })
  let color = (id: string) => colors[id] ?? remoteMachineColor(id, hosts)
  let save = (id: string, color: string) => { if (!palette.includes(color)) return; let next = { ...colors, [id]: color }; setColors(next); localStorage.setItem('remote-machine-colors', JSON.stringify(next)) }
  return { color, save }
}
export let RemoteMachineIcon = ({ platform, color }: { platform?: string; color: string }) => <svg className={css.icon} viewBox="0 0 20 20" stroke={color} role="img" aria-label={`${platforms[platform ?? ''] ?? 'Remote'} machine`}>
  {platform === 'linux' ? <><rect x="5" y="2" width="10" height="16" rx="1" /><path d="M7 6h6M7 10h6M7 14h3" /></> : <><rect x="2" y="3" width="16" height="11" rx="1" /><path d="M7 18h6M10 14v4" /></>}
</svg>
export let RemoteMachineHeading = ({ host, name, color, expanded, toggle, details, chevron }: { host: RemoteHost; name: string; color: string; expanded: boolean; toggle: () => void; details: () => void; chevron: ReactNode }) => <div className={css.heading}>
  <button type="button" data-picker-action data-machine-toggle className={css.toggle} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} machine ${name}`} onClick={toggle}>{chevron}</button>
  <button type="button" data-picker-action data-machine-details={host.id} className={css.machine} aria-label={`Machine ${name}`} title={`Machine details · ${host.service}`} onClick={details}><RemoteMachineIcon platform={host.machine?.platform} color={color} /><span>{name}</span><small>{host.sessions.length}</small></button>
</div>
export let RemoteMachineDetails = ({ host, name, color, changeColor, back }: { host: RemoteHost; name: string; color: string; changeColor: (color: string) => void; back: PanelBack }) => {
  let machine = host.machine, pages = host.sessions.flatMap(session => session.panes).length
  let pickColor = (event: MouseEvent<HTMLButtonElement>) => changeColor(event.currentTarget.dataset.color!)
  let keys = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); back.run() } }
  return <div className={css.details} onKeyDown={keys}>
    <div className={css.navigation}><BackButton back={back} /><RemoteMachineIcon platform={machine?.platform} color={color} /><strong>{name}</strong></div>
    <dl><div><dt>Service</dt><dd>{host.service}</dd></div><div><dt>Machine ID</dt><dd>{host.id}</dd></div>
      {machine && <><div><dt>System</dt><dd>{platforms[machine.platform] ?? machine.platform} · {machine.arch}</dd></div>{machine.version && <div><dt>bmux</dt><dd>{machine.version}{machine.revision ? ` · ${machine.revision}` : ''}</dd></div>}</>}
      <div><dt>Access</dt><dd>{host.permission === 'control' ? 'Watch and control' : 'Watch only'}</dd></div><div><dt>Sessions</dt><dd>{host.sessions.length}</dd></div><div><dt>Pages</dt><dd>{pages}</dd></div>
    </dl>
    {!machine && <p>Update this host to show its name, system and bmux version.</p>}
    <div className={css.colors} role="radiogroup" aria-label="Machine icon color">{palette.map(value => <button type="button" key={value} role="radio" aria-checked={color === value} aria-label={`Machine color ${value}`} data-color={value} onClick={pickColor}><RemoteMachineIcon platform={machine?.platform} color={value} /></button>)}</div>
  </div>
}
let platforms: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }
