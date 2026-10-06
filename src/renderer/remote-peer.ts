import { publishIceOffer } from '../shared/remote-ice'

type TransportMessage = { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit; iceServers?: RTCIceServer[]; data?: string; width?: number; height?: number; relayOnly?: boolean; trickle?: boolean }
let bridge = (window as unknown as { remoteBridge: { receive: (listener: (message: TransportMessage) => void) => void; send: (message: unknown) => void } }).remoteBridge
let canvas = document.querySelector('canvas')!
let context = canvas.getContext('2d')!
let peer: RTCPeerConnection | undefined
let channel: RTCDataChannel | undefined
let track: CanvasCaptureMediaStreamTrack | undefined
let drawing = false
let latestFrame: HTMLImageElement | undefined
let candidates: RTCIceCandidateInit[] = []
let connected = () => {
  if (peer?.connectionState === 'connected') track?.requestFrame()
  bridge.send({ type: 'connection', state: peer?.connectionState })
}
setInterval(() => {
  if (peer?.connectionState !== 'connected' || !latestFrame) return
  context.drawImage(latestFrame, 0, 0, canvas.width, canvas.height)
  track?.requestFrame()
}, 100)
bridge.receive(message => {
  void (async () => {
    if (message.type === 'start') {
      peer?.close()
      candidates = []
      latestFrame = undefined
      peer = new RTCPeerConnection({ iceServers: message.iceServers, iceTransportPolicy: message.relayOnly ? 'relay' : 'all' })
      canvas.width = message.width ?? 1280; canvas.height = message.height ?? 800
      let stream = canvas.captureStream(10)
      track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      peer.addTrack(track, stream)
      channel = peer.createDataChannel('bmux')
      channel.onmessage = event => { if (typeof event.data === 'string' && event.data.length <= 65536) bridge.send({ type: 'data', data: event.data }) }
      peer.onconnectionstatechange = connected
      await publishIceOffer(peer, sdp => bridge.send({ type: 'offer', sdp }), message.trickle ? candidate => bridge.send({ type: 'candidate', candidate }) : undefined)
    } else if (message.type === 'answer' && message.sdp) {
      await peer?.setRemoteDescription(message.sdp)
      for (let candidate of candidates.splice(0)) await peer?.addIceCandidate(candidate)
    } else if (message.type === 'candidate' && message.candidate) {
      if (peer?.remoteDescription) await peer.addIceCandidate(message.candidate)
      else candidates.push(message.candidate)
    }
    else if (message.type === 'data' && channel?.readyState === 'open' && channel.bufferedAmount < 262144) channel.send(message.data!)
    else if (message.type === 'frame' && message.data && !drawing) {
      drawing = true
      try {
        let bitmap = new Image()
        bitmap.src = message.data
        await bitmap.decode()
        latestFrame = bitmap
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); track?.requestFrame()
      } finally { drawing = false; bridge.send({ type: 'frame-ack' }) }
    }
  })().catch(() => bridge.send({ type: 'error', error: 'Transport operation failed' }))
})
bridge.send({ type: 'ready' })
