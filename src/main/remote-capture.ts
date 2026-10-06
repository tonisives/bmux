import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { createFrameCapture } from './frame-capture'

type CaptureOptions = { contents: Electron.WebContents; iceServers: RTCIceServer[]; relayOnly?: boolean; signal: (sdp: RTCSessionDescriptionInit) => void; candidate?: (value: RTCIceCandidateInit) => void; data: (message: string) => void; closed: () => void }
let frameSize = (frame: Electron.NativeImage) => {
  let size = frame.getSize(), scale = Math.min(1, 1920 / size.width, 1080 / size.height)
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
}
let encodeFrame = (frame: Electron.NativeImage) => {
  let size = frameSize(frame)
  if (size.width !== frame.getSize().width || size.height !== frame.getSize().height) frame = frame.resize(size)
  return `data:image/jpeg;base64,${frame.toJPEG(80).toString('base64')}`
}
let subscribe = createFrameCapture(encodeFrame)

export let createRemoteCapture = async (options: CaptureOptions) => {
  // A hidden native window supports focus enumeration on Linux; an offscreen
  // transport has no native view for Electron's global focus lookup.
  let window = new BrowserWindow({ show: false, width: 16, height: 16, webPreferences: { preload: path.join(import.meta.dirname, '../preload/remote.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'bmux-trusted-transport' } })
  window.webContents.setWebRTCIPHandlingPolicy('default')
  let framePending = false, disposed = false
  let unsubscribe: (() => void) | undefined
  let send = (message: unknown) => { if (!disposed && !window.isDestroyed()) window.webContents.send('remote-message', message) }
  let sendFrame = (data: string) => {
    if (framePending) return
    framePending = true
    send({ type: 'frame', data })
  }
  let close = () => {
    if (disposed) return
    disposed = true
    ipcMain.off('remote-message', receive)
    options.contents.off('destroyed', close)
    unsubscribe?.()
    if (!window.isDestroyed()) window.destroy()
    options.closed()
  }
  let receive = (event: Electron.IpcMainEvent, message: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; data?: string; state?: string }) => {
    if (event.sender !== window.webContents || !message || typeof message.type !== 'string') return
    if (message.type === 'ready') {
      void options.contents.capturePage().then(frame => {
        if (disposed) return
        send({ type: 'start', iceServers: options.iceServers, relayOnly: options.relayOnly, trickle: !!options.candidate, ...frameSize(frame) })
        unsubscribe = subscribe(options.contents, sendFrame)
        sendFrame(encodeFrame(frame))
      }).catch(() => {
        if (disposed) return
        send({ type: 'start', iceServers: options.iceServers, relayOnly: options.relayOnly, trickle: !!options.candidate })
        unsubscribe = subscribe(options.contents, sendFrame)
      })
    } else if (message.type === 'frame-ack') framePending = false
    else if (message.type === 'connection' && message.state === 'connected') {
      void options.contents.capturePage().then(frame => sendFrame(encodeFrame(frame))).catch(() => undefined)
    }
    else if (message.type === 'offer' && message.sdp) options.signal(message.sdp)
    else if (message.type === 'candidate' && message.candidate) options.candidate?.(message.candidate)
    else if (message.type === 'data' && typeof message.data === 'string') options.data(message.data)
    else if (message.type === 'error' || message.type === 'connection' && ['failed', 'closed'].includes(message.state ?? '')) close()
  }
  ipcMain.on('remote-message', receive)
  options.contents.once('destroyed', close)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  try { await window.loadFile(path.join(import.meta.dirname, '../renderer/remote-peer.html')) } catch (error) { close(); throw error }
  return { close, answer: (sdp: RTCSessionDescriptionInit) => send({ type: 'answer', sdp }), candidate: (candidate: RTCIceCandidateInit) => send({ type: 'candidate', candidate }), send: (data: string) => send({ type: 'data', data }) }
}
