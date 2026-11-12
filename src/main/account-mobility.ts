import fs from 'node:fs'
import path from 'node:path'
import { generateKeyPairSync, createPrivateKey, createPublicKey, diffieHellman, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { writeAtomic } from './store'

export type MobilityCommand = { id: string; account: string; phase: 'provision' | 'export' | 'import' | 'activate'; identity: Record<string, unknown>; seal: Record<string, unknown>; operation: { request: Record<string, unknown>; targetKey: string; platform: string; persona: string; label: string }; capsule?: string; expires: number }
type Result = Record<string, unknown>
type Encryption = { encrypt: (text: string) => Buffer; decrypt: (data: Buffer) => string; available: () => boolean }
export let encryptAccountTransfer = (value: unknown, targetKey: string, context: string) => {
  let text = JSON.stringify(value)
  if (Buffer.byteLength(text) > 32_000_000) throw new Error('ACCOUNT_TRANSFER_TOO_LARGE')
  let packed = gzipSync(text)
  if (packed.length > 4_000_000) throw new Error('ACCOUNT_TRANSFER_TOO_LARGE')
  let pair = generateKeyPairSync('x25519'), peer = createPublicKey({ key: Buffer.from(targetKey, 'base64'), type: 'spki', format: 'der' })
  let key = createHash('sha256').update(diffieHellman({ privateKey: pair.privateKey, publicKey: peer })).digest(), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(context))
  let encrypted = Buffer.concat([cipher.update(packed), cipher.final()])
  return JSON.stringify({ key: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') })
}
export let decryptAccountTransfer = (capsule: string, privateKey: string, context: string) => {
  if (capsule.length > 6_000_000) throw new Error('ACCOUNT_TRANSFER_TOO_LARGE')
  let value = JSON.parse(capsule), key = createHash('sha256').update(diffieHellman({ privateKey: createPrivateKey(privateKey), publicKey: createPublicKey({ key: Buffer.from(value.key, 'base64'), type: 'spki', format: 'der' }) })).digest()
  let cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64')); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(Buffer.from(value.tag, 'base64'))
  return JSON.parse(gunzipSync(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]), { maxOutputLength: 32_000_000 }).toString())
}
export let createAccountMobility = (directory: string, encryption: Encryption, apply: (command: MobilityCommand, value: unknown, valid: () => boolean) => Promise<Result>) => {
  let file = path.join(directory, 'account-mobility.json'), keyFile = path.join(directory, 'account-mobility-key.bin')
  let journal: Record<string, { fingerprint: string; result: Result }> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  let privateKey: string | undefined
  let key = () => {
    if (!encryption.available()) throw new Error('ACCOUNT_SECURE_STORAGE_UNAVAILABLE')
    if (!privateKey) {
      if (fs.existsSync(keyFile)) privateKey = encryption.decrypt(fs.readFileSync(keyFile))
      else {
        privateKey = generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.writeFileSync(keyFile, encryption.encrypt(privateKey), { mode: 0o600, flag: 'wx', flush: true })
      }
    }
    return privateKey
  }
  let running = new Map<string, Promise<Result>>()
  return {
    publicKey: () => { try { return createPublicKey(key()).export({ type: 'spki', format: 'der' }).toString('base64') } catch { return undefined } },
    apply: (command: MobilityCommand, valid: () => boolean): Promise<Result> => {
      if (!/^[a-f0-9-]{36}$/.test(command.id) || !/^[a-f0-9-]{36}$/.test(command.account) || !['provision','export','import','activate'].includes(command.phase) || !Number.isFinite(command.expires) || command.expires <= Date.now() || command.expires > Date.now() + 60000) return Promise.reject(new Error('ACCOUNT_REQUEST_EXPIRED'))
      let id = command.id + ':' + command.phase
      let { expires: _expires, ...body } = command
      let fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex')
      let previous = journal[id]
      if (previous) return previous.fingerprint === fingerprint ? Promise.resolve(previous.result) : Promise.reject(new Error('ACCOUNT_TRANSFER_CHANGED'))
      let active = running.get(id)
      if (active) return active
      let operation = (async () => {
        if (!valid()) throw new Error('ACCOUNT_REQUEST_EXPIRED')
        let value = command.phase === 'import' ? decryptAccountTransfer(command.capsule!, key(), command.id + ':' + command.account) : undefined
        let result = await apply(command, value, valid)
        journal[id] = { fingerprint, result }
        writeAtomic(file, JSON.stringify(journal))
        return result
      })().finally(() => running.delete(id))
      running.set(id, operation)
      return operation
    },
  }
}
