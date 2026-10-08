import { expect, it, vi } from 'vitest'
import { prepareIceAnswer, publishIceOffer } from '../src/shared/remote-ice'

let fixture = () => {
  let sdp = { type: 'offer' as const, sdp: 'fixture description' }
  let peer = { onicecandidate: undefined as ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | undefined, onicegatheringstatechange: undefined as (() => void) | undefined, iceGatheringState: 'gathering', localDescription: { toJSON: () => sdp }, createOffer: vi.fn(async () => sdp), createAnswer: vi.fn(async () => sdp), setLocalDescription: vi.fn(async () => undefined) }
  return { peer, sdp, connection: peer as unknown as RTCPeerConnection }
}

it('publishes a usable offer while gathering is still pending and forwards later candidates', async () => {
  let { peer, sdp, connection } = fixture(), publish = vi.fn(), candidate = vi.fn()
  await publishIceOffer(connection, publish, candidate)
  expect(peer.iceGatheringState).toBe('gathering')
  expect(publish).toHaveBeenCalledWith(sdp)
  let value = { candidate: 'fixture candidate', sdpMid: '0' }
  peer.onicecandidate!({ candidate: { toJSON: () => value } })
  expect(candidate).toHaveBeenCalledWith(value)
  peer.onicecandidate!({ candidate: null })
  expect(publish).toHaveBeenCalledOnce()
})

it('retains complete descriptions for older viewers without candidate signaling', async () => {
  let { peer, sdp, connection } = fixture(), publish = vi.fn()
  await publishIceOffer(connection, publish)
  expect(publish).not.toHaveBeenCalled()
  peer.onicecandidate!({ candidate: { toJSON: () => ({ candidate: 'fixture' }) } })
  expect(publish).not.toHaveBeenCalled()
  peer.onicecandidate!({ candidate: null })
  expect(publish).toHaveBeenCalledExactlyOnceWith(sdp)
})

it('returns an answer before gathering completes when the host supports candidates', async () => {
  let { peer, sdp, connection } = fixture(), candidate = vi.fn()
  expect(await prepareIceAnswer(connection, candidate)).toEqual(sdp)
  expect(peer.iceGatheringState).toBe('gathering')
  let value = { candidate: 'fixture candidate' }
  peer.onicecandidate!({ candidate: { toJSON: () => value } })
  expect(candidate).toHaveBeenCalledWith(value)
})

it('waits for a complete answer when connecting to an older host', async () => {
  let { peer, sdp, connection } = fixture(), completed = vi.fn()
  let answer = prepareIceAnswer(connection).then(completed)
  await vi.waitFor(() => expect(peer.onicegatheringstatechange).toBeTypeOf('function'), { interval: 1 })
  expect(completed).not.toHaveBeenCalled()
  peer.iceGatheringState = 'complete'
  peer.onicegatheringstatechange!()
  await answer
  expect(completed).toHaveBeenCalledWith(sdp)
})
