import { publishIceOffer } from '../shared/remote-ice'
import { remoteStreamQuality, type RemoteStreamQuality } from '../shared/remote-management'

type TransportMessage = { type: string; media?: boolean; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; iceServers?: RTCIceServer[]; data?: string; width?: number; height?: number; relayOnly?: boolean; trickle?: boolean; request?: string; quality?: RemoteStreamQuality }
let bridge = (window as unknown as { remoteBridge: { receive: (listener: (message: TransportMessage) => void) => void; send: (message: unknown) => void } }).remoteBridge
let canvas = document.querySelector('canvas')!
let context = canvas.getContext('2d')!
let peer: RTCPeerConnection | undefined
let channel: RTCDataChannel | undefined
let track: CanvasCaptureMediaStreamTrack | undefined
let drawing = false
let stopped = false
let latestFrame: HTMLImageElement | undefined
let candidates: RTCIceCandidateInit[] = []
let quality = remoteStreamQuality('quality'), lastFrameAt = 0
let paint = () => {
  if (!latestFrame || Date.now() - lastFrameAt < 1000/quality.maxFps) return
  let scale = Math.min(1,quality.maxWidth/latestFrame.naturalWidth,quality.maxHeight/latestFrame.naturalHeight)
  let width = Math.max(1,Math.round(latestFrame.naturalWidth*scale)), height = Math.max(1,Math.round(latestFrame.naturalHeight*scale))
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
  context.drawImage(latestFrame,0,0,width,height); track?.requestFrame(); lastFrameAt = Date.now()
}
let applyQuality = async () => {
  let sender = peer?.getSenders().find(sender => sender.track?.kind === 'video')
  if (!sender) throw new Error('QUALITY_UNAVAILABLE')
  let parameters = sender.getParameters()
  if (!parameters.encodings.length) throw new Error('QUALITY_UNAVAILABLE')
  for (let encoding of parameters.encodings) { encoding.maxBitrate = quality.maxBitrate; encoding.maxFramerate = quality.maxFps }
  await sender.setParameters(parameters)
  lastFrameAt = 0; paint()
}
let connected = () => {
  if (peer?.connectionState === 'connected') track?.requestFrame()
  bridge.send({ type: 'connection', state: peer?.connectionState })
}
setInterval(() => {
  if (stopped || peer?.connectionState !== 'connected' || !latestFrame) return
  paint()
}, 100)
bridge.receive(message => {
  void (async () => {
    if (message.type === 'stop') {
      stopped = true; latestFrame = undefined; track?.stop()
      if (channel && channel.readyState !== 'closed') await new Promise<void>(resolve => {
        channel!.addEventListener('close', () => resolve(), { once: true })
        channel!.close()
      })
      peer?.close()
      bridge.send({ type: 'stopped' })
      return
    }
    if (stopped) return
    if (message.type === 'start') {
      peer?.close()
      candidates = []
      latestFrame = undefined
      quality = message.quality ?? remoteStreamQuality('quality'); lastFrameAt = 0; track = undefined
      peer = new RTCPeerConnection({ iceServers: message.iceServers, iceTransportPolicy: message.relayOnly ? 'relay' : 'all' })
      canvas.width = message.width ?? 1280; canvas.height = message.height ?? 800
      if (message.media !== false) {
        let stream = canvas.captureStream(10)
        track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
        peer.addTrack(track, stream)
      }
      channel = peer.createDataChannel('bmux')
      channel.onmessage = event => { if (typeof event.data === 'string' && event.data.length <= 65536) bridge.send({ type: 'data', data: event.data }) }
      peer.onconnectionstatechange = connected
      await publishIceOffer(peer, sdp => bridge.send({ type: 'offer', sdp }), message.trickle ? candidate => bridge.send({ type: 'candidate', candidate }) : undefined)
      if (message.media !== false) await applyQuality()
    } else if (message.type === 'answer' && message.sdp) {
      await peer?.setRemoteDescription(message.sdp)
      for (let candidate of candidates.splice(0)) await peer?.addIceCandidate(candidate)
    } else if (message.type === 'candidate' && message.candidate) {
      if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate)
      else candidates.push(message.candidate)
    }
    else if (message.type === 'quality' && message.quality) {
      let previous = quality; quality = message.quality
      try { await applyQuality(); bridge.send({type:'quality-applied',request:message.request,quality}) }
      catch { quality = previous; bridge.send({type:'quality-applied',request:message.request,error:'QUALITY_UNAVAILABLE'}) }
    }
    else if (message.type === 'data' && channel?.readyState === 'open' && channel.bufferedAmount < 262144) channel.send(message.data!)
    else if (message.type === 'frame' && message.data && !drawing) {
      drawing = true
      try {
        let bitmap = new Image()
        bitmap.src = message.data
        await bitmap.decode()
        latestFrame = bitmap
        paint()
      } finally { drawing = false; bridge.send({ type: 'frame-ack' }) }
    }
  })().catch(() => bridge.send({ type: 'error', error: 'Transport operation failed' }))
})
bridge.send({ type: 'ready' })
