import { WebContentsView } from 'electron'
import type { BaseWindow, Rectangle } from 'electron'

export let AGENT_INPUT_LOCK_MS = 20_000
export let scheduleAgentInputUnlock = (lastUsed: number, unlock: () => void) => {
  let check = () => {
    let remaining = lastUsed + AGENT_INPUT_LOCK_MS - Date.now()
    if (remaining <= 0) { unlock(); return }
    // A timer can fire before its wall-clock deadline; keep the expiry armed.
    let timer = setTimeout(check, remaining)
    timer.unref()
  }
  check()
}

// A separate native view receives human input; CDP still targets the page below.
export let createAgentInputLock = (page: WebContentsView, placement: () => { window: BaseWindow; bounds: Rectangle }, installKeys: (contents: Electron.WebContents) => void, showAgent: () => void) => {
  let pageContents = page.webContents
  let shield: WebContentsView | undefined
  let owner: BaseWindow | undefined
  let locked = false
  let guardFocus = () => { if (locked) shield?.webContents.focus() }
  let refresh = () => {
    if (!shield) return
    let { window, bounds } = placement()
    if (window.isDestroyed()) return
    if (owner !== window) {
      if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(shield)
      owner = window
      window.contentView.addChildView(shield)
    }
    shield.setBounds(bounds)
    shield.setVisible(locked && page.getVisible())
  }
  let setLocked = (value: boolean) => {
    locked = value
    if (locked && !shield) {
      shield = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      shield.setBackgroundColor('#00000000')
      installKeys(shield.webContents)
      let contents = shield.webContents
      contents.on('will-navigate', (event, url) => { event.preventDefault(); if (locked && url === 'bmux:agent-info') showAgent() })
      void contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Agent input lock</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;cursor:not-allowed}body{font:12px system-ui;color:#e6d9b5}aside{position:absolute;right:12px;top:12px}a{display:flex;align-items:center;gap:6px;padding:7px 10px;background:#252a32;border:1px solid #5b5342;color:inherit;text-decoration:none;cursor:pointer}a:focus-visible{outline:2px solid #e6d9b5;outline-offset:2px}svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}</style><aside role="status"><a href="bmux:agent-info" aria-label="Agent information" title="Agent information"><svg viewBox="0 0 20 20"><rect x="4" y="8" width="12" height="9" rx="1"/><path d="M6 8V6a4 4 0 0 1 8 0v2"/></svg>Agent controlling · input locked</a></aside>')).catch(error => { if (!contents.isDestroyed()) console.error('bmux: agent input lock', error) })
      refresh()
    }
    let restoreFocus = !locked && shield?.webContents.isFocused()
    refresh()
    if (locked && pageContents.isFocused()) guardFocus()
    if (restoreFocus) pageContents.focus()
  }
  page.on('bounds-changed', refresh)
  pageContents.on('focus', guardFocus)
  let dispose = () => {
    locked = false
    page.off('bounds-changed', refresh)
    pageContents.off('focus', guardFocus)
    pageContents.off('destroyed', dispose)
    if (shield) { if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(shield); if (!shield.webContents.isDestroyed()) shield.webContents.close(); shield = undefined }
  }
  pageContents.once('destroyed', dispose)
  return { setLocked, refresh, dispose, get view() { return shield }, get contents() { return shield?.webContents } }
}
