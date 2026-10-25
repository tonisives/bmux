import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostCredentialEncryption } from '../src/main/host-credentials'

it('retains encrypted host credentials across restart and authenticates ciphertext', () => {
  let directory = fs.mkdtempSync(path.join(os.tmpdir(),'bmux-host-key-')), file = path.join(directory,'key')
  try {
    let encryption = hostCredentialEncryption(file), ciphertext = encryption.encrypt('fixture-password')
    expect(ciphertext.includes(Buffer.from('fixture-password'))).toBe(false)
    expect(hostCredentialEncryption(file).decrypt(ciphertext)).toBe('fixture-password')
    ciphertext[ciphertext.length-1] ^= 1
    expect(() => encryption.decrypt(ciphertext)).toThrow()
    fs.chmodSync(file,0o644)
    expect(() => hostCredentialEncryption(file)).toThrow('mode 600')
  } finally { fs.rmSync(directory,{recursive:true,force:true}) }
})
