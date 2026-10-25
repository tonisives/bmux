import type { RemoteHost, RemoteWindow } from './remote-sessions'

export let remoteMachinePalette = ['#8d9fff', '#34b3a0', '#e5a450', '#dc7d9c', '#a78bfa', '#94a3b8']
export let remoteMachineName = (host: RemoteHost, hosts: RemoteHost[]) => host.machine?.name || (hosts.filter(item => item.service === host.service).length > 1 ? `${host.service} · ${host.id.slice(0, 8)}` : host.service)
export let remoteMachineColor = (id: string, hosts: Pick<RemoteHost, 'id'>[]) => remoteMachinePalette[Math.max(0, hosts.map(host => host.id).sort().indexOf(id)) % remoteMachinePalette.length]
export let remoteWindowName = (window: RemoteWindow, paneId?: string) => {
  let pane = window.panes.find(pane => pane.id === paneId) ?? window.panes[0]
  return (window.automaticName ? pane?.title : window.name.trim()) || pane?.title || 'Blank page'
}
