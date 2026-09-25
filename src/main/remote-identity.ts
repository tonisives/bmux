import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import fs from 'node:fs'
import { envelopeText, validEnvelope } from '../shared/remote'
import type { RemoteEnvelope } from '../shared/remote'

export let remoteIdentity = (file: string) => {
  if (!fs.existsSync(file)) {
    let keys = generateKeyPairSync('ed25519')
    fs.writeFileSync(file, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
  }
  if (fs.statSync(file).mode & 0o077) throw new Error('Remote identity must have mode 600')
  let privateKey = createPrivateKey(fs.readFileSync(file))
  let publicKey = createPublicKey(privateKey).export({ format: 'jwk' })
  let id = createHash('sha256').update(publicKey.x!).digest('hex')
  let seal = (to: string, generation: string, payload: unknown): RemoteEnvelope => {
    let envelope = { version: 1 as const, from: id, to, generation, nonce: randomBytes(24).toString('hex'), expires: Date.now() + 60000, payload: JSON.stringify(payload) }
    return { ...envelope, signature: sign(null, Buffer.from(envelopeText(envelope)), privateKey).toString('base64') }
  }
  return { id, publicKey, seal }
}

export let createEnvelopeVerifier = (destination: string, generation: string, keys: () => Record<string, { kty: string; crv: string; x: string }>) => {
  let seen = new Map<string, number>()
  return (envelope: RemoteEnvelope) => {
    let now = Date.now()
    for (let [nonce, expires] of seen) if (expires <= now) seen.delete(nonce)
    if (!validEnvelope(envelope, destination, generation, now) || seen.has(envelope.nonce)) throw new Error('Invalid or replayed remote message')
    let key = keys()[envelope.from]
    if (!key || key.kty !== 'OKP' || key.crv !== 'Ed25519' || !verify(null, Buffer.from(envelopeText(envelope)), createPublicKey({ key, format: 'jwk' }), Buffer.from(envelope.signature, 'base64'))) throw new Error('Unapproved remote identity')
    seen.set(envelope.nonce, envelope.expires)
    return JSON.parse(envelope.payload) as Record<string, unknown>
  }
}
