import { expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEnvelopeVerifier, remoteIdentity } from '../src/main/remote-identity'

it('authenticates the full offer and rejects substitution, replay, and revocation', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-signing-'))
  try {
    let client = remoteIdentity(path.join(directory, 'client.pem')), attacker = remoteIdentity(path.join(directory, 'attacker.pem'))
    let keys = { [client.id]: client.publicKey as { kty: string; crv: string; x: string } }
    let verify = createEnvelopeVerifier('host', 'generation', () => keys)
    let offer = client.seal('host', 'generation', { type: 'answer', sdp: 'fingerprint' })
    expect(() => verify({ ...offer, payload: JSON.stringify({ type: 'answer', sdp: 'substituted' }) })).toThrow()
    expect(verify(offer)).toEqual({ type: 'answer', sdp: 'fingerprint' })
    expect(() => verify(offer)).toThrow('replayed')
    expect(() => verify(attacker.seal('host', 'generation', {}))).toThrow('Unapproved')
    keys = {}
    expect(() => verify(client.seal('host', 'generation', {}))).toThrow('Unapproved')
    expect(() => verify(client.seal('host', 'old-generation', {}))).toThrow()
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
