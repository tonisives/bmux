export let publishIceOffer = async (peer: RTCPeerConnection, publish: (sdp: RTCSessionDescriptionInit) => void, candidate?: (value: RTCIceCandidateInit) => void) => {
  peer.onicecandidate = event => {
    if (event.candidate) candidate?.(event.candidate.toJSON())
    else if (!candidate) publish(peer.localDescription!.toJSON())
  }
  await peer.setLocalDescription(await peer.createOffer())
  // A slow TURN candidate must not hold up an otherwise usable direct route.
  // Older viewers still receive a single description after gathering completes.
  if (candidate) publish(peer.localDescription!.toJSON())
}

export let prepareIceAnswer = async (peer: RTCPeerConnection, candidate?: (value: RTCIceCandidateInit) => void) => {
  if (candidate) peer.onicecandidate = event => { if (event.candidate) candidate(event.candidate.toJSON()) }
  await peer.setLocalDescription(await peer.createAnswer())
  if (!candidate && peer.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error('Connection timed out')), 15000)
    peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve() } }
  })
  return peer.localDescription!.toJSON()
}
