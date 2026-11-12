import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { createAccountMobility, encryptAccountTransfer, decryptAccountTransfer } from '../src/main/account-mobility'
import type { MobilityCommand } from '../src/main/account-mobility'
import { includedProxy } from '../src/main/account-proxies'
import { parseProfileProxy } from '../src/main/profile-proxy'

it('encrypts transfers for one destination and binds the account and operation', () => {
  let pair = generateKeyPairSync('x25519'), other = generateKeyPairSync('x25519')
  let publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let capsule = encryptAccountTransfer({ cookie: 'fixture-login', proxy: 'fixture-secret' }, publicKey, 'operation:account')
  expect(capsule).not.toContain('fixture-login')
  expect(decryptAccountTransfer(capsule, privateKey, 'operation:account')).toEqual({ cookie: 'fixture-login', proxy: 'fixture-secret' })
  expect(() => decryptAccountTransfer(capsule, privateKey, 'another:account')).toThrow()
  expect(() => decryptAccountTransfer(capsule, other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'operation:account')).toThrow()
  let tampered = JSON.parse(capsule); let bytes = Buffer.from(tampered.data, 'base64'); bytes[0] ^= 1; tampered.data = bytes.toString('base64')
  expect(() => decryptAccountTransfer(JSON.stringify(tampered), privateKey, 'operation:account')).toThrow()
})
it('deduplicates handoff phases across relaunch, rejects changed commands and retries busy operations', async () => {
  let directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bmux-mobility-'))
  try {
    let encryption = { available: () => true, encrypt: (text: string) => Buffer.from(text), decrypt: (data: Buffer) => data.toString() }, apply = vi.fn(async () => ({ phase: 'provision', identity: 'fixture' }))
    let create = () => createAccountMobility(directory, encryption, apply), host = create(), publicKey = host.publicKey()
    let command: MobilityCommand = { id: '10000000-0000-4000-8000-000000000001', account: '20000000-0000-4000-8000-000000000001', phase: 'provision', identity: {}, seal: {}, operation: { targetKey: publicKey!, platform: 'tiktok', persona: 'Fixture', label: 'Fixture', request: { route: 'us-west' } }, expires: Date.now() + 30000 }
    apply.mockRejectedValueOnce(new Error('CONTROL_HELD'))
    await expect(host.apply(command, () => true)).rejects.toThrow('CONTROL_HELD')
    await host.apply(command, () => true)
    expect(await create().apply({ ...command, expires: Date.now() + 40000 }, () => true)).toEqual({ phase: 'provision', identity: 'fixture' })
    expect(create().publicKey()).toBe(publicKey)
    expect(apply).toHaveBeenCalledTimes(2)
    await expect(host.apply({ ...command, account: '20000000-0000-4000-8000-000000000002' }, () => true)).rejects.toThrow('ACCOUNT_TRANSFER_CHANGED')
    await expect(host.apply({ ...command, phase: 'activate' }, () => false)).rejects.toThrow('ACCOUNT_REQUEST_EXPIRED')
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
it('accepts only the canonical endpoint of an included route', () => {
  let proxy = includedProxy('us-west')
  expect(parseProfileProxy(proxy)).toEqual(proxy)
  expect(() => parseProfileProxy({ ...proxy, host: 'arbitrary.example' })).toThrow()
  expect(() => includedProxy('unknown')).toThrow()
})
