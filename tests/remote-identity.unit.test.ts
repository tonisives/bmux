import { expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createEnvelopeVerifier, remoteIdentity } from '../src/main/remote-identity'

it('checks POSIX identity permissions and accepts Windows ACL-backed files', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bmux-identity-mode-'))
  let platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    let file = path.join(directory, 'client.pem'), identity = remoteIdentity(file)
    fs.chmodSync(file, 0o644)
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(() => remoteIdentity(file)).toThrow('mode 600')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(remoteIdentity(file).id).toBe(identity.id)
  } finally { Object.defineProperty(process, 'platform', platform); fs.rmSync(directory, { recursive: true, force: true }) }
})

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
