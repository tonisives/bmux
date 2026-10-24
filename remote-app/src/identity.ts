import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import * as Crypto from 'expo-crypto'
import { readSecret, writeSecret } from './storage'
import type { ViewerIdentity } from '../../remote/web/client'
import { fromBase64, identityFromSeed, toBase64 } from './signing'
export let loadIdentity = async (owner: string): Promise<ViewerIdentity> => {
  let key = 'bmux.remote.key.' + bytesToHex(sha256(utf8ToBytes(owner)))
  let stored = await readSecret(key)
  let seed = stored ? fromBase64(stored) : await Crypto.getRandomBytesAsync(32)
  if (!stored) await writeSecret(key, toBase64(seed))
  return identityFromSeed(seed)
}
