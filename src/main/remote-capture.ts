import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'

type CaptureOptions = { contents: Electron.WebContents; iceServers: RTCIceServer[]; relayOnly?: boolean; signal: (sdp: RTCSessionDescriptionInit) => void; data: (message: string) => void; closed: () => void }
let captures = new Map<number, { listeners: Set<(data: string) => void>; throttled: boolean }>()
let subscribe = (contents: Electron.WebContents, listener: (data: string) => void) => {
  let capture = captures.get(contents.id)
  if (!capture) {
    capture = { listeners: new Set(), throttled: contents.getBackgroundThrottling() }
    captures.set(contents.id, capture)
    contents.setBackgroundThrottling(false)
    let last = 0
    contents.beginFrameSubscription(true, frame => {
      if (Date.now() - last < 33) return
      last = Date.now()
      let size = frame.getSize()
      if (size.width > 1920 || size.height > 1080) frame = frame.resize({ width: Math.round(size.width * Math.min(1920 / size.width, 1080 / size.height)), height: Math.round(size.height * Math.min(1920 / size.width, 1080 / size.height)) })
      let data = `data:image/jpeg;base64,${frame.toJPEG(80).toString('base64')}`
      for (let notify of capture!.listeners) notify(data)
    })
  }
  capture.listeners.add(listener)
  void contents.capturePage().then(frame => { if (capture!.listeners.has(listener)) listener(`data:image/jpeg;base64,${frame.toJPEG(80).toString('base64')}`) }).catch(() => undefined)
  return () => {
    capture!.listeners.delete(listener)
    if (capture!.listeners.size) return
    captures.delete(contents.id)
    if (!contents.isDestroyed()) { contents.endFrameSubscription(); contents.setBackgroundThrottling(capture!.throttled) }
  }
}

export let createRemoteCapture = async (options: CaptureOptions) => {
  let window = new BrowserWindow({ show: false, width: 16, height: 16, webPreferences: { preload: path.join(import.meta.dirname, '../preload/remote.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'bmux-trusted-transport' } })
  window.webContents.setWebRTCIPHandlingPolicy('default')
  let framePending = false, disposed = false
  let unsubscribe: (() => void) | undefined
  let send = (message: unknown) => { if (!disposed && !window.isDestroyed()) window.webContents.send('remote-message', message) }
  let close = () => {
    if (disposed) return
    disposed = true
    ipcMain.off('remote-message', receive)
    options.contents.off('destroyed', close)
    unsubscribe?.()
    if (!window.isDestroyed()) window.destroy()
    options.closed()
  }
  let receive = (event: Electron.IpcMainEvent, message: { type: string; sdp?: RTCSessionDescriptionInit; data?: string; state?: string }) => {
    if (event.sender !== window.webContents || !message || typeof message.type !== 'string') return
    if (message.type === 'ready') {
      send({ type: 'start', iceServers: options.iceServers, relayOnly: options.relayOnly })
      unsubscribe = subscribe(options.contents, data => {
        if (framePending) return
        framePending = true
        send({ type: 'frame', data })
      })
    } else if (message.type === 'frame-ack') framePending = false
    else if (message.type === 'offer' && message.sdp) options.signal(message.sdp)
    else if (message.type === 'data' && typeof message.data === 'string') options.data(message.data)
    else if (message.type === 'error' || message.type === 'connection' && ['failed', 'closed'].includes(message.state ?? '')) close()
  }
  ipcMain.on('remote-message', receive)
  options.contents.once('destroyed', close)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  try { await window.loadFile(path.join(import.meta.dirname, '../renderer/remote-peer.html')) } catch (error) { close(); throw error }
  return { close, answer: (sdp: RTCSessionDescriptionInit) => send({ type: 'answer', sdp }), send: (data: string) => send({ type: 'data', data }) }
}
