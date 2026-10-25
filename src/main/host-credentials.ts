import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export let hostCredentialEncryption = (file: string) => {
  fs.mkdirSync(path.dirname(file), { recursive:true, mode:0o700 })
  if (!fs.existsSync(file)) {
    let descriptor = fs.openSync(file,'wx',0o600)
    try { fs.writeFileSync(descriptor,randomBytes(32)); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
  }
  if (fs.statSync(file).mode & 0o077) throw new Error('Host credential key must have mode 600')
  let key = fs.readFileSync(file)
  if (key.length !== 32) throw new Error('Invalid host credential key')
  return {
    available: () => true,
    encrypt: (text: string) => {
      let nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,nonce)
      let ciphertext = Buffer.concat([cipher.update(text,'utf8'),cipher.final()])
      return Buffer.concat([Buffer.from([1]),nonce,cipher.getAuthTag(),ciphertext])
    },
    decrypt: (data: Buffer) => {
      if (data.length < 29 || data[0] !== 1) throw new Error('Invalid host credential data')
      let decipher = createDecipheriv('aes-256-gcm',key,data.subarray(1,13))
      decipher.setAuthTag(data.subarray(13,29))
      return Buffer.concat([decipher.update(data.subarray(29)),decipher.final()]).toString('utf8')
    },
  }
}
