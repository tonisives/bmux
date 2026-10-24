import { getPublicKeyAsync, signAsync, verifyAsync, hashes } from '@noble/ed25519'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { ViewerIdentity } from '../../remote/web/client'

hashes.sha512Async = async value => sha512(value)
export let toBase64 = (value: Uint8Array) => btoa(Array.from(value, item => String.fromCharCode(item)).join(''))
export let fromBase64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), item => item.charCodeAt(0))
export let identityFingerprint = async (key: JsonWebKey) => bytesToHex(sha256(utf8ToBytes(key.x!)))
export let identityFromSeed = async (seed: Uint8Array): Promise<ViewerIdentity> => {
  let bytes = await getPublicKeyAsync(seed)
  let publicKey: JsonWebKey = { kty: 'OKP', crv: 'Ed25519', x: toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
  return {
    publicKey, fingerprint: identityFingerprint,
    sign: async text => toBase64(await signAsync(utf8ToBytes(text), seed)),
    verify: async (key, signature, text) => verifyAsync(fromBase64(signature), utf8ToBytes(text), fromBase64(key.x!), { zip215: false }),
  }
}
