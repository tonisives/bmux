import { app, ipcMain } from 'electron'
import { createRuntime } from '../../src/main/runtime'
import { initialModel, newPane, newWindow } from '../../src/main/model'
import type { RemotePage } from '../../src/main/runtime'
import type { RemoteViewUpdate, RemoteWorkspaceSnapshot } from '../../src/shared/remote'

;(app as any).setAppPath(process.cwd())
app.setPath('userData', process.env.BMUX_DATA_DIR!)
void app.whenReady().then(async () => {
  let runtime = createRuntime(process.env.BMUX_DATA_DIR!), host = initialModel(), session = host.sessions[0], window = session.windows[0]
  session.name = 'Hosted work'; window.number = 7; window.name = 'Host splits'; window.automaticName = false
  for (let name of ['second', 'third', 'floating']) { let pane = newPane(session.defaultProfileId, `https://fixture.test/${name}`, host); pane.title = name; window.panes.push(pane) }
  window.layout = { kind: 'split', id: 'host-root', axis: 'horizontal', ratio: .35, first: { kind: 'pane', paneId: window.panes[0].id }, second: { kind: 'split', id: 'host-child', axis: 'vertical', ratio: .6, first: { kind: 'pane', paneId: window.panes[1].id }, second: { kind: 'pane', paneId: window.panes[2].id } } }
  window.floating = [{ paneId: window.panes[3].id, x: 100, y: 100, width: 480, height: 320 }]
  let other = newWindow('Other host window', session.defaultProfileId, false, host); other.number = 9; session.windows.push(other)
  let snapshot: RemoteWorkspaceSnapshot = { session, profiles: host.profiles.map(({ id, name }) => ({ id, name })), selection: { windowId: window.id, paneId: window.panes[1].id } }
  let updates = new Set<(update: RemoteViewUpdate) => void>(), media = new Map<number, string>(), held: (() => void)[] = []
  let fixture: { hold: boolean; held: typeof held; runtime: typeof runtime; snapshot: typeof snapshot; open: typeof open; media: typeof media; publish: () => void; flush: () => void }
  let view = { hostId: 'fixture-host', generation: 'fixture-generation', sessionId: session.id, name: session.name, service: 'Fixture machine', canControl: true, connected: true, controlling: false, occupied: false, panes: session.windows.flatMap(window => window.panes) }
  let open = async (client: string, pane?: string) => {
    let page: RemotePage = { key: 'fixture-host:session', title: session.name, workspace: true, view: { ...view, pane }, attach: (contents, _close, update, pane) => {
      if (pane) { media.set(contents.id, pane); contents.once('destroyed', () => media.delete(contents.id)); return }
      updates.add(update); contents.once('destroyed', () => updates.delete(update))
      contents.once('did-finish-load', () => { let send = () => update({ ...view, workspace: structuredClone(snapshot) }); if (fixture.hold) held.push(send); else send() })
    } }
    await runtime.openRemotePage(client, page)
  }
  fixture = { hold: false, held, runtime, snapshot, open, media, publish: () => { for (let update of updates) update({ ...view, workspace: structuredClone(snapshot) }) }, flush: () => { for (let send of held.splice(0)) send() } }
  ;(globalThis as any).workspaceFixture = fixture
  ipcMain.handle('state', event => runtime.state(runtime.sourceClient(event.sender.id)))
  ipcMain.handle('command', (event, command) => runtime.execute(command, runtime.sourceClient(event.sender.id)))
  ipcMain.on('bounds', (event, bounds) => runtime.setBounds(event.sender.id, bounds))
  // Layout tests supply host snapshots directly; transport is covered by remote-host.
  ipcMain.handle('remote-client-selection', () => new Promise(() => {}))
  app.on('open-url', (event, url) => { event.preventDefault(); void runtime.openExternalLink(runtime.model.lastFocusedClientId ?? runtime.model.clients[0].id, url) })
  app.on('will-quit', () => runtime.shutdown())
  await runtime.start(false)
})
