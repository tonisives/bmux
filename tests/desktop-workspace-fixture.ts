import type { ElectronApplication } from '@playwright/test'

// Supply host metadata for UI fixtures whose HTTP service does not negotiate WebRTC.
export let installDesktopWorkspaceFixture = async (application: ElectronApplication) => application.context().addInitScript(() => {
  let bridge = (window as any).remoteClient
  if (!bridge) return
  void bridge.selection().then((selection: any) => {
    if (!selection.metadata) return
    let session = selection.host.sessions.find((session: any) => session.id === selection.session)
    let windows = session.windows ?? [{ id: `${session.id}-window`, number: 1, name: session.panes[0]?.title ?? session.name, panes: session.panes, layout: { kind: 'pane', paneId: session.panes[0].id } }]
    let snapshot = { session: { ...session, defaultProfileId: 'host-profile', windows: windows.map((window: any) => ({ ...window, panes: window.panes.map((pane: any) => ({ ...pane, profileId: 'host-profile', zoom: 1, url: `${selection.origin}/remote-page` })) })) }, profiles: [{ id: 'host-profile', name: 'Host profile' }], selection: { windowId: windows[0].id, paneId: windows[0].panes[0].id } }
    return bridge.update({ name: session.name, connected: false, controlling: false, occupied: false, pane: windows[0].panes[0].id, panes: snapshot.session.windows.flatMap((window: any) => window.panes), workspace: snapshot })
  })
})
