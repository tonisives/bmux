import { expect, test } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createCipheriv, createDecipheriv, createHmac, publicEncrypt, createPublicKey, randomBytes } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let protocol = await import(pathToFileURL(path.resolve('examples/plugins/experimental.bitwarden/protocol.mjs')).href)
test('native framing accepts fragmented and combined UTF-8 messages and rejects oversize frames', () => {
  let messages: unknown[] = [], decode = protocol.createDecoder((message: unknown) => messages.push(message))
  let first = protocol.encodeFrame({ name: 'Test café' }), second = protocol.encodeFrame({ status: 'locked' })
  decode(first.subarray(0, 2)); decode(Buffer.concat([first.subarray(2), second]))
  expect(messages).toEqual([{ name: 'Test café' }, { status: 'locked' }])
  let invalid = Buffer.alloc(4); invalid.writeUInt32LE(4_194_305)
  expect(() => decode(invalid)).toThrow('size')
})
test('pairs as bmux with fresh RSA keys and exchanges authenticated status/lookup with a mock peer', async () => {
  let child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('exit', 0) })
  let key = randomBytes(64), commands: string[] = [], applicationName = '', buffer = Buffer.alloc(0)
  child.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
      let size = buffer.readUInt32LE(0), message = JSON.parse(buffer.subarray(4, size + 4).toString())
      buffer = buffer.subarray(size + 4)
      let response: Record<string, unknown> = { messageId: message.messageId, version: 1 }
      if (message.command === 'bw-handshake') {
        applicationName = message.payload.applicationName
        let publicKey = createPublicKey({ key: Buffer.from(message.payload.publicKey, 'base64'), format: 'der', type: 'spki' })
        response.payload = { status: 'success', sharedKey: publicEncrypt({ key: publicKey, oaepHash: 'sha1' }, key).toString('base64') }
      } else {
        let [iv, encrypted, mac] = message.encryptedCommand.slice(2).split('|').map((part: string) => Buffer.from(part, 'base64'))
        expect(createHmac('sha256', key.subarray(32)).update(Buffer.concat([iv, encrypted])).digest().equals(mac)).toBe(true)
        let decipher = createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv); decipher.setAutoPadding(false)
        let request = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString().replace(/\0+$/, ''))
        commands.push(request.command)
        let payload = request.command === 'bw-status' ? [{ status: 'unlocked', active: true }] : [{ credentialId: 'fixture-id', userName: 'fixture-user', password: 'disposable-test-password', name: 'Fixture' }]
        if (request.command === 'bw-credential-retrieval') expect(request.payload.uri).toBe('https://example.test/login')
        let replyIV = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key.subarray(0, 32), replyIV)
        let ciphertext = Buffer.concat([cipher.update(JSON.stringify({ command: request.command, payload })), cipher.final()])
        let replyMac = createHmac('sha256', key.subarray(32)).update(Buffer.concat([replyIV, ciphertext])).digest()
        response.encryptedPayload = `2.${replyIV.toString('base64')}|${ciphertext.toString('base64')}|${replyMac.toString('base64')}`
      }
      let body = Buffer.from(JSON.stringify(response)), header = Buffer.alloc(4); header.writeUInt32LE(body.length)
      child.stdout.write(header.subarray(0, 1)); child.stdout.write(Buffer.concat([header.subarray(1), body]))
    }
  })
  let connection = protocol.createBitwardenConnection(child)
  try {
    await connection.connect(); expect(applicationName).toBe('bmux')
    expect(await connection.command('bw-status')).toEqual([{ status: 'unlocked', active: true }])
    expect((await connection.command('bw-credential-retrieval', { uri: 'https://example.test/login' })).length).toBe(1)
    expect(commands).toEqual(['bw-status', 'bw-credential-retrieval'])
  } finally { connection.close() }
})
test('rejects tampered encrypted responses and pairing denial', async () => {
  let key = randomBytes(64), encrypted = protocol.encrypt({ status: 'locked' }, key, false)
  expect(protocol.decrypt(encrypted, key)).toEqual({ status: 'locked' })
  let parts = encrypted.split('|'); parts[2] = randomBytes(32).toString('base64')
  expect(() => protocol.decrypt(parts.join('|'), key)).toThrow('authentication')
  let child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => child.emit('exit', 0) })
  child.stdin.on('data', protocol.createDecoder((message: { messageId: string }) => child.stdout.write(protocol.encodeFrame({ messageId: message.messageId, payload: { error: 'canceled' } }))))
  let connection = protocol.createBitwardenConnection(child)
  try { await expect(connection.connect()).rejects.toThrow('approved') } finally { connection.close() }
})
