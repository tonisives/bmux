import { randomBytes, randomUUID, generateKeyPairSync, privateDecrypt, constants, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto'

export let encodeFrame = message => {
  let payload = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4)
  header.writeUInt32LE(payload.length)
  return Buffer.concat([header, payload])
}
export let createDecoder = receive => {
  let buffer = Buffer.alloc(0)
  return chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      let size = buffer.readUInt32LE(0)
      if (!size || size > 4_194_304) throw new Error('Invalid native message size')
      if (buffer.length < size + 4) return
      let message = JSON.parse(buffer.subarray(4, size + 4).toString('utf8'))
      buffer = buffer.subarray(size + 4); receive(message)
    }
  }
}
export let encrypt = (payload, key, zeroPadding = true) => {
  let iv = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), iv)
  let plaintext = Buffer.from(JSON.stringify(payload))
  if (zeroPadding) { cipher.setAutoPadding(false); plaintext = Buffer.concat([plaintext, Buffer.alloc((16 - plaintext.length % 16) % 16)]) }
  let ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  let mac = createHmac('sha256', key.subarray(32)).update(Buffer.concat([iv, ciphertext])).digest()
  return `2.${iv.toString('base64')}|${ciphertext.toString('base64')}|${mac.toString('base64')}`
}
export let decrypt = (value, key, zeroPadding = false) => {
  if (typeof value !== 'string' || !value.startsWith('2.')) throw new Error('Unsupported encrypted message')
  let parts = value.slice(2).split('|')
  if (parts.length !== 3) throw new Error('Invalid encrypted message')
  let [iv, ciphertext, mac] = parts.map(part => Buffer.from(part, 'base64'))
  let expected = createHmac('sha256', key.subarray(32)).update(Buffer.concat([iv, ciphertext])).digest()
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new Error('Invalid message authentication')
  let decipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv)
  decipher.setAutoPadding(!zeroPadding)
  let plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(zeroPadding ? plaintext.replace(/\0+$/, '') : plaintext)
}
export let createBitwardenConnection = child => {
  let pending = new Map(), sharedKey, closed = false
  let fail = () => {
    if (closed) return
    closed = true
    for (let request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Bitwarden desktop connection closed')) }
    pending.clear(); sharedKey?.fill(0); sharedKey = undefined
  }
  let decode = createDecoder(message => {
    let request = pending.get(message.messageId)
    if (request) { pending.delete(message.messageId); clearTimeout(request.timer); request.resolve(message) }
  })
  child.stdout.on('data', chunk => { try { decode(chunk) } catch { fail(); child.kill() } })
  child.stderr?.resume()
  child.stdin.on('error', fail); child.on('error', fail); child.on('exit', fail)
  let request = (message, timeout = 10000) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('Bitwarden connection unavailable')); return }
    let messageId = randomUUID()
    let timer = setTimeout(() => { pending.delete(messageId); reject(new Error('Bitwarden request timed out')) }, timeout)
    pending.set(messageId, { resolve, reject, timer })
    child.stdin.write(encodeFrame({ ...message, version: 1, messageId }))
  })
  let connect = async () => {
    let pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    let response = await request({ command: 'bw-handshake', payload: { applicationName: 'bmux', publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') } }, 100000)
    if (response.payload?.status !== 'success' || !response.payload.sharedKey) throw new Error('Desktop pairing was not approved or supported')
    // OAEP-SHA1 is required by Bitwarden's existing native protocol.
    sharedKey = privateDecrypt({ key: pair.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(response.payload.sharedKey, 'base64'))
    if (sharedKey.length !== 64) throw new Error('Unsupported shared key')
  }
  let command = async (command, payload) => {
    if (!sharedKey) throw new Error('Connect first')
    let response = await request({ encryptedCommand: encrypt({ command, payload }, sharedKey) })
    // Electron's IPC serializes the desktop EncString instance as an object.
    let encryptedPayload = response.encryptedPayload
    let result = decrypt(typeof encryptedPayload === 'string' ? encryptedPayload : encryptedPayload?.encryptedString, sharedKey)
    if (result.command !== command || result.payload?.error) throw new Error('Vault locked or desktop request rejected')
    return result.payload
  }
  return { connect, command, close: () => { fail(); child.kill() } }
}
