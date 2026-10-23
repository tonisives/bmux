import type { Snapshot } from './types'

export type EncryptedPreview = { key: JsonWebKey; iv: string; data: string }
let encode = (data: ArrayBuffer | Uint8Array) => btoa(Array.from(data instanceof Uint8Array ? data : new Uint8Array(data), byte => String.fromCharCode(byte)).join(''))
let decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0))
let sharedKey = async (privateKey: CryptoKey, publicKey: JsonWebKey) => {
  let peer = await crypto.subtle.importKey('jwk', publicKey, 'X25519', false, [])
  return crypto.subtle.deriveKey({ name: 'X25519', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export let encryptRemotePreview = async (publicKey: JsonWebKey, snapshot: Snapshot): Promise<EncryptedPreview> => {
  let pair = await crypto.subtle.generateKey('X25519', true, ['deriveKey']) as CryptoKeyPair
  let iv = crypto.getRandomValues(new Uint8Array(12)), key = await sharedKey(pair.privateKey, publicKey)
  let data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(snapshot)))
  return { key: await crypto.subtle.exportKey('jwk', pair.publicKey), iv: encode(iv), data: encode(data) }
}
export let createRemotePreviewReceiver = async () => {
  let pair = await crypto.subtle.generateKey('X25519', true, ['deriveKey']) as CryptoKeyPair
  return {
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
    decrypt: async (value: EncryptedPreview): Promise<Snapshot> => {
      let key = await sharedKey(pair.privateKey, value.key)
      let data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv) }, key, decode(value.data))
      let snapshot = JSON.parse(new TextDecoder().decode(data)) as Snapshot
      if (!Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt <= 0 || typeof snapshot.image !== 'string' || snapshot.image.length > 65536 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(snapshot.image)) throw new Error('Invalid remote preview')
      return snapshot
    },
  }
}
