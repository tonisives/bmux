import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { capturePageFrame, createFrameCapture } from './frame-capture'
import { randomUUID } from 'node:crypto'
import { remoteStreamQuality, type RemoteStreamQuality } from '../shared/remote-management'

type CaptureOptions = { contents?: Electron.WebContents; quality?: RemoteStreamQuality; iceServers: RTCIceServer[]; relayOnly?: boolean; signal: (sdp: RTCSessionDescriptionInit) => void; candidate?: (value: RTCIceCandidateInit) => void; data: (message: string) => void; closed: () => void }
let frameSize = (frame: Electron.NativeImage) => {
  let size = frame.getSize(), scale = Math.min(1, 1920 / size.width, 1080 / size.height)
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
}
let encodeFrame = (frame: Electron.NativeImage) => {
  if (frame.isEmpty()) return
  let size = frameSize(frame)
  if (size.width !== frame.getSize().width || size.height !== frame.getSize().height) frame = frame.resize(size)
  return `data:image/jpeg;base64,${frame.toJPEG(80).toString('base64')}`
}
let subscribe = createFrameCapture(encodeFrame)

export let createRemoteCapture = async (options: CaptureOptions) => {
  let sourceError = () => options.contents?.isDestroyed() ? new Error('Page closed') : options.contents?.isCrashed() ? new Error('Page process crashed. Reload to recover.') : undefined
  let error = sourceError()
  if (error) throw error
  // A hidden native window supports focus enumeration on Linux; an offscreen
  // transport has no native view for Electron's global focus lookup.
  let window = new BrowserWindow({ show: false, width: 16, height: 16, webPreferences: { preload: path.join(import.meta.dirname, '../preload/remote.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: 'bmux-trusted-transport' } })
  window.webContents.setWebRTCIPHandlingPolicy('default')
  let framePending = false, disposed = false
  let unsubscribe: (() => void) | undefined
  let pendingQuality = new Map<string, { resolve:(quality: RemoteStreamQuality) => void; reject:(error: Error) => void; timer:ReturnType<typeof setTimeout> }>()
  let send = (message: unknown) => { if (!disposed && !window.isDestroyed()) window.webContents.send('remote-message', message) }
  let sendFrame = (data: string) => {
    if (framePending) return
    framePending = true
    send({ type: 'frame', data })
  }
  let start = (frame?: Electron.NativeImage) => {
    if (disposed) return
    send({ type: 'start', media: !!options.contents, quality: options.quality ?? remoteStreamQuality('quality'), iceServers: options.iceServers, relayOnly: options.relayOnly, trickle: !!options.candidate, ...(frame && !frame.isEmpty() ? frameSize(frame) : {}) })
    if (options.contents) unsubscribe = subscribe(options.contents, sendFrame)
    let data = frame && encodeFrame(frame)
    if (data) sendFrame(data)
  }
  let close = () => {
    if (disposed) return
    disposed = true
    ipcMain.off('remote-message', receive)
    options.contents?.off('destroyed', close)
    options.contents?.off('render-process-gone', close)
    for (let pending of pendingQuality.values()) { clearTimeout(pending.timer); pending.reject(new Error('Stream closed')) }; pendingQuality.clear()
    unsubscribe?.()
    if (!window.isDestroyed()) window.destroy()
    options.closed()
  }
  let receive = (event: Electron.IpcMainEvent, message: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; data?: string; state?: string; request?: string; quality?: RemoteStreamQuality; error?: string }) => {
    if (event.sender !== window.webContents || !message || typeof message.type !== 'string') return
    if (message.type === 'ready') {
      if (options.contents) void capturePageFrame(options.contents).then(start).catch(() => start())
      else start()
    } else if (message.type === 'frame-ack') framePending = false
    else if (message.type === 'connection' && message.state === 'connected' && options.contents) {
      void capturePageFrame(options.contents).then(frame => { let data = encodeFrame(frame); if (data) sendFrame(data) }).catch(() => undefined)
    }
    else if (message.type === 'offer' && message.sdp) options.signal(message.sdp)
    else if (message.type === 'candidate' && message.candidate) options.candidate?.(message.candidate)
    else if (message.type === 'data' && typeof message.data === 'string') options.data(message.data)
    else if (message.type === 'quality-applied' && message.request) {
      let pending = pendingQuality.get(message.request)
      if (pending) { clearTimeout(pending.timer); pendingQuality.delete(message.request); if (message.quality) pending.resolve(message.quality); else pending.reject(new Error('QUALITY_UNAVAILABLE')) }
    }
    else if (message.type === 'error' || message.type === 'connection' && ['failed', 'closed'].includes(message.state ?? '')) close()
  }
  ipcMain.on('remote-message', receive)
  options.contents?.once('destroyed', close)
  options.contents?.once('render-process-gone', close)
  window.webContents.once('render-process-gone', close)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  try { await window.loadFile(path.join(import.meta.dirname, '../renderer/remote-peer.html')) } catch (error) { close(); throw sourceError() ?? error }
  error = sourceError()
  if (error || disposed) { close(); throw error ?? new Error('Stream closed') }
  return { close, answer: (sdp: RTCSessionDescriptionInit) => send({ type: 'answer', sdp }), candidate: (candidate: RTCIceCandidateInit) => send({ type: 'candidate', candidate }), send: (data: string) => send({ type: 'data', data }), quality:(quality: RemoteStreamQuality) => new Promise<RemoteStreamQuality>((resolve,reject) => {
    if (disposed || !options.contents) { reject(new Error('QUALITY_UNAVAILABLE')); return }
    let request = randomUUID(), timer = setTimeout(() => { pendingQuality.delete(request); reject(new Error('QUALITY_UNAVAILABLE')) },5000)
    pendingQuality.set(request,{resolve,reject,timer}); send({type:'quality',request,quality})
  }) }
}
