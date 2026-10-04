import { WebContentsView } from 'electron'
import type { Extension, Session } from 'electron'

// Hanzisize 0.2.7 and 1.0.1 only inject from their popup or resize shortcut.
// Run their own content script in the extension context, retaining Chromium's
// host-permission checks and the profile's existing saved settings.
export let hanzisizeAutoResizeSource = `(() => {
  if (globalThis.bmuxHanzisizeAutoResize) return
  globalThis.bmuxHanzisizeAutoResize = true
  let pending = new Map()
  let resize = (id, tab) => {
    if (!/^https?:\\/\\//.test(tab.url || '')) return
    let token = {}
    pending.set(id, token)
    let current = () => pending.get(id) === token
    chrome.storage.local.get(['language', 'minFontSize'], settings => {
      if (chrome.runtime.lastError || !current()) return
      if (typeof settings.language !== 'string' || !(Number(settings.minFontSize) > 0)) return
      let message = { language: settings.language, minFontSize: Number(settings.minFontSize), mode: 'initial' }
      chrome.tabs.sendMessage(id, message, { frameId: 0 }, () => {
        let missing = chrome.runtime.lastError
        if (!missing || !current()) return
        chrome.tabs.executeScript(id, { file: 'jquery-3.5.1.min.js' }, () => {
          if (chrome.runtime.lastError || !current()) return
          chrome.tabs.executeScript(id, { file: 'contentScript.js' }, () => {
            if (chrome.runtime.lastError || !current()) return
            chrome.tabs.sendMessage(id, message, { frameId: 0 }, () => { void chrome.runtime.lastError })
          })
        })
      })
    })
  }
  chrome.tabs.onUpdated.addListener((id, change, tab) => {
    if (change.status === 'loading') pending.delete(id)
    if (change.status === 'complete') resize(id, tab)
  })
  chrome.tabs.onRemoved.addListener(id => pending.delete(id))
  chrome.tabs.query({}, tabs => {
    if (chrome.runtime.lastError) return
    for (let tab of tabs) if (tab.status === 'complete') resize(tab.id, tab)
  })
})()`

export let createHanzisizeCompatibility = (session: Session) => {
  let hosts = new Map<string, WebContentsView>()
  let start = (extension: Extension) => {
    if (extension.name !== 'Hanzisize' || !['0.2.7', '1.0.1'].includes(extension.version) || extension.manifest.manifest_version !== 2 || hosts.has(extension.id)) return
    // Its lazy background page does not start until the popup sends a message.
    // An unattached, sandboxed view of this inert bundled document supplies an
    // extension context without loading the popup or selecting a browser tab.
    let view = new WebContentsView({ webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    hosts.set(extension.id, view)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', event => event.preventDefault())
    void view.webContents.loadURL(`chrome-extension://${extension.id}/robots.txt`).then(() => {
      if (!view.webContents.isDestroyed()) return view.webContents.executeJavaScript(hanzisizeAutoResizeSource)
    }).catch(() => {
      if (!view.webContents.isDestroyed()) console.warn('Hanzisize automatic resizing could not be initialized')
    })
  }
  let stop = (id: string) => {
    let view = hosts.get(id)
    hosts.delete(id)
    if (view && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
  }
  let ready = (_event: Electron.Event, extension: Extension) => start(extension)
  let unloaded = (_event: Electron.Event, extension: Extension) => stop(extension.id)
  session.extensions.on('extension-ready', ready)
  session.extensions.on('extension-unloaded', unloaded)
  for (let extension of session.extensions.getAllExtensions()) start(extension)
  return () => {
    session.extensions.off('extension-ready', ready)
    session.extensions.off('extension-unloaded', unloaded)
    for (let id of hosts.keys()) stop(id)
  }
}
