import { app, webContents } from 'electron'
import type { Session, WebContents } from 'electron'

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
  let backgrounds = new Map<WebContents, () => void>()
  let observe = (contents: WebContents) => {
    if (contents.session !== session || contents.getType() !== 'backgroundPage' || backgrounds.has(contents)) return
    let inject = () => {
      if (contents.isDestroyed()) return
      let extension = session.extensions.getAllExtensions().find(item => contents.getURL().startsWith(`chrome-extension://${item.id}/`))
      if (extension?.name !== 'Hanzisize' || !['0.2.7', '1.0.1'].includes(extension.version) || extension.manifest.manifest_version !== 2) return
      void contents.executeJavaScript(hanzisizeAutoResizeSource).catch(() => {
        if (!contents.isDestroyed()) console.warn('Hanzisize automatic resizing could not be initialized')
      })
    }
    backgrounds.set(contents, inject)
    contents.on('dom-ready', inject)
    contents.once('destroyed', () => backgrounds.delete(contents))
    if (!contents.isLoadingMainFrame()) inject()
  }
  let created = (_event: Electron.Event, contents: WebContents) => observe(contents)
  app.on('web-contents-created', created)
  for (let contents of webContents.getAllWebContents()) observe(contents)
  return () => {
    app.off('web-contents-created', created)
    for (let [contents, inject] of backgrounds) if (!contents.isDestroyed()) contents.off('dom-ready', inject)
    backgrounds.clear()
  }
}
