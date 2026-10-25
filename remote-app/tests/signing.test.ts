import { expect, it } from 'vitest'
import { envelopeText } from '../../src/shared/remote'
import { fromBase64, identityFromSeed } from '../src/signing'

it('native signing interoperates with the existing WebCrypto host identity', async () => {
  let seed = new Uint8Array(32).fill(7)
  let native = await identityFromSeed(seed)
  let privateKey = await crypto.subtle.importKey('jwk', { ...native.publicKey, d: btoa(String.fromCharCode(...seed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }, 'Ed25519', false, ['sign'])
  let publicKey = await crypto.subtle.importKey('jwk', native.publicKey, 'Ed25519', false, ['verify'])
  let text = envelopeText({ version: 1, from: 'viewer', to: 'host', generation: 'runtime', nonce: 'fixture-nonce-12345', expires: Date.now() + 30000, payload: '{"type":"open"}' })
  let bytes = new TextEncoder().encode(text)
  let signature = await native.sign(text)
  expect(await crypto.subtle.verify('Ed25519', publicKey, Uint8Array.from(fromBase64(signature)), bytes)).toBe(true)
  let web = await crypto.subtle.sign('Ed25519', privateKey, bytes)
  expect(await native.verify(native.publicKey, btoa(String.fromCharCode(...new Uint8Array(web))), text)).toBe(true)
  expect(await native.verify(native.publicKey, signature, text + 'tampered')).toBe(false)
  let fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(native.publicKey.x))
  expect(await native.fingerprint(native.publicKey)).toBe(Array.from(new Uint8Array(fingerprint), item => item.toString(16).padStart(2, '0')).join(''))
})
