import { BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'

export type LocalRemoteSession = { id: string; name: string; panes: { id: string; title: string }[] }
export type LocalRemoteHost = { id: string; generation: string; key: JsonWebKey; permission: 'watch' | 'control'; service: string; sessions: LocalRemoteSession[] }
export type LocalRemoteListing = { authenticated: boolean; hosts: LocalRemoteHost[] }

export let createLocalRemote = () => {
  let origin = new URL(process.env.BMUX_REMOTE_URL ?? 'https://remote.bmux.cc').origin
  if (!origin.startsWith('https://') && !origin.startsWith('http://127.0.0.1:')) throw new Error('Remote service requires HTTPS')
  let viewer: BrowserWindow | undefined, login: BrowserWindow | undefined
  let selected: { host: LocalRemoteHost; session: string } | undefined
  let cookie = async () => (await session.defaultSession.cookies.get({ url: origin })).find(item => item.name === 'bmux_session')?.value
  let list = async (): Promise<LocalRemoteListing> => {
    let token = await cookie()
    if (!token) return { authenticated: false, hosts: [] }
    let response = await fetch(`${origin}/api/hosts`, { headers: { Cookie: `bmux_session=${token}` }, signal: AbortSignal.timeout(10000) })
    if (response.status === 401) return { authenticated: false, hosts: [] }
    if (!response.ok) throw new Error('Remote sessions unavailable')
    return { authenticated: true, hosts: await response.json() as LocalRemoteHost[] }
  }
  let connect = async (publicKey: JsonWebKey) => {
    let token = await cookie()
    if (!token) throw new Error('Sign in to remote')
    let response = await fetch(`${origin}/api/connect`, { method: 'POST', headers: { Cookie: `bmux_session=${token}`, Origin: origin, 'Content-Type': 'application/json', 'X-Bmux-Desktop': '1' }, body: JSON.stringify({ publicKey }), signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('Remote connection unavailable')
    return response.json()
  }
  ipcMain.handle('remote-client-selection', event => {
    if (event.sender !== viewer?.webContents || !selected) throw new Error('Untrusted renderer')
    return { origin, ...selected }
  })
  ipcMain.handle('remote-client-connect', (event, publicKey: JsonWebKey) => {
    if (event.sender !== viewer?.webContents) throw new Error('Untrusted renderer')
    return connect(publicKey)
  })
  let open = async (hostId?: string, sessionId?: string) => {
    let listing = await list()
    if (!listing.authenticated || !hostId || !sessionId) {
      if (!login || login.isDestroyed()) {
        login = new BrowserWindow({ title: 'Sign in to bmux remote', width: 850, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
        login.webContents.setWindowOpenHandler(details => new URL(details.url).origin === 'https://accounts.google.com'
          ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } }
          : { action: 'deny' })
        login.on('closed', () => { login = undefined })
        await login.loadURL(origin)
      }
      login.focus()
      return
    }
    let host = listing.hosts.find(item => item.id === hostId && item.sessions.some(item => item.id === sessionId))
    if (!host) throw new Error('Remote session unavailable')
    selected = { host, session: sessionId }
    if (!viewer || viewer.isDestroyed()) {
      viewer = new BrowserWindow({ title: `${host.sessions.find(item => item.id === sessionId)?.name} - bmux remote`, width: 1200, height: 850, show: false, webPreferences: { preload: path.join(import.meta.dirname, '../preload/remote-client.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      viewer.webContents.on('will-navigate', event => event.preventDefault())
      viewer.on('closed', () => { viewer = undefined; selected = undefined })
    }
    await viewer.loadFile(path.join(import.meta.dirname, '../renderer/remote-client.html'))
    viewer.show()
    viewer.focus()
  }
  let close = () => { viewer?.close(); login?.close() }
  return { list, open, close }
}
