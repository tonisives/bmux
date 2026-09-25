type TransportMessage = { type: string; sdp?: RTCSessionDescriptionInit; iceServers?: RTCIceServer[]; data?: string; width?: number; height?: number; relayOnly?: boolean }
let bridge = (window as unknown as { remoteBridge: { receive: (listener: (message: TransportMessage) => void) => void; send: (message: unknown) => void } }).remoteBridge
let canvas = document.querySelector('canvas')!
let context = canvas.getContext('2d')!
let peer: RTCPeerConnection | undefined
let channel: RTCDataChannel | undefined
let track: CanvasCaptureMediaStreamTrack | undefined
let drawing = false
let connected = () => bridge.send({ type: 'connection', state: peer?.connectionState })
bridge.receive(message => {
  void (async () => {
    if (message.type === 'start') {
      peer?.close()
      peer = new RTCPeerConnection({ iceServers: message.iceServers, iceTransportPolicy: message.relayOnly ? 'relay' : 'all' })
      canvas.width = message.width ?? 1280; canvas.height = message.height ?? 800
      let stream = canvas.captureStream(0)
      track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
      peer.addTrack(track, stream)
      channel = peer.createDataChannel('bmux')
      channel.onmessage = event => { if (typeof event.data === 'string' && event.data.length <= 65536) bridge.send({ type: 'data', data: event.data }) }
      peer.onconnectionstatechange = connected
      peer.onicecandidate = event => { if (!event.candidate) bridge.send({ type: 'offer', sdp: peer!.localDescription!.toJSON() }) }
      await peer.setLocalDescription(await peer.createOffer())
    } else if (message.type === 'answer' && message.sdp) await peer?.setRemoteDescription(message.sdp)
    else if (message.type === 'data' && channel?.readyState === 'open' && channel.bufferedAmount < 262144) channel.send(message.data!)
    else if (message.type === 'frame' && message.data && !drawing) {
      drawing = true
      try {
        let bitmap = new Image()
        bitmap.src = message.data
        await bitmap.decode()
        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) { canvas.width = bitmap.width; canvas.height = bitmap.height }
        context.drawImage(bitmap, 0, 0); track?.requestFrame()
      } finally { drawing = false; bridge.send({ type: 'frame-ack' }) }
    }
  })().catch(() => bridge.send({ type: 'error', error: 'Transport operation failed' }))
})
bridge.send({ type: 'ready' })
