import { WebContentsView } from 'electron'

// A separate native view receives human input; CDP still targets the page below.
export let createAgentInputLock = (page: WebContentsView, installKeys: (contents: Electron.WebContents) => void) => {
  let shield: WebContentsView | undefined
  let locked = false
  let guardFocus = () => { if (locked) shield?.webContents.focus() }
  let resize = () => {
    let { width, height } = page.getBounds()
    shield?.setBounds({ x: 0, y: 0, width, height })
  }
  let setLocked = (value: boolean) => {
    locked = value
    if (locked && !shield) {
      shield = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      shield.setBackgroundColor('#00000000')
      installKeys(shield.webContents)
      void shield.webContents.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><title>Agent input lock</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;cursor:not-allowed}body{font:12px system-ui;color:#e6d9b5}aside{position:absolute;right:12px;top:12px;display:flex;align-items:center;gap:6px;padding:7px 10px;background:#252a32;border:1px solid #5b5342;pointer-events:none}svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}</style><aside role="status"><svg viewBox="0 0 20 20"><rect x="4" y="8" width="12" height="9" rx="1"/><path d="M6 8V6a4 4 0 0 1 8 0v2"/></svg>Agent controlling · input locked</aside>'))
      page.addChildView(shield)
      resize()
    }
    let restoreFocus = !locked && shield?.webContents.isFocused()
    shield?.setVisible(locked)
    if (locked && page.webContents.isFocused()) guardFocus()
    if (restoreFocus) page.webContents.focus()
  }
  page.on('bounds-changed', resize)
  page.webContents.on('focus', guardFocus)
  let dispose = () => {
    locked = false
    page.off('bounds-changed', resize)
    page.webContents.off('focus', guardFocus)
    if (shield) { page.removeChildView(shield); if (!shield.webContents.isDestroyed()) shield.webContents.close(); shield = undefined }
  }
  page.webContents.once('destroyed', dispose)
  return { setLocked, dispose, get contents() { return shield?.webContents } }
}
