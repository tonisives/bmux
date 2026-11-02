import { expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createEmailAuth } from '../remote/email-auth'

let fixture = () => {
  let credential: { owner: string; salt: string; password_hash: string } | undefined
  let attempts = 0
  let query = vi.fn(async (sql: string, values: unknown[]) => {
    if (sql.includes('INSERT INTO bmux_password_attempts')) return { rows: [{ attempts: ++attempts }], rowCount: 1 }
    if (sql.includes('INSERT INTO bmux_passwords')) {
      if (credential && credential.password_hash !== values[3]) return { rows: [], rowCount: 0 }
      credential = { owner: values[0] as string, salt: values[1] as string, password_hash: values[2] as string }
      return { rows: [credential], rowCount: 1 }
    }
    if (sql.includes('FROM bmux_passwords')) return { rows: credential ? [credential] : [], rowCount: credential ? 1 : 0 }
    throw new Error('Unexpected query')
  })
  return { auth: createEmailAuth({ query } as unknown as Pool), query, credential: () => credential, throttle: () => { attempts = 10 } }
}

it('adds a salted password to the existing owner and normalizes the login email', async () => {
  let value = fixture()
  await value.auth.setPassword('google-owner', 'a sufficiently long password', undefined)
  expect(value.credential()?.password_hash).not.toContain('sufficiently')
  expect(await value.auth.verify(' Person@Example.com ', 'a sufficiently long password')).toBe('google-owner')
  expect(value.query).toHaveBeenCalledWith(expect.stringContaining('WHERE p.email=$1'), ['person@example.com'])
  await expect(value.auth.verify('person@example.com', 'wrong')).rejects.toThrow('Email or password is incorrect.')
})

it('requires the current password before changing an existing one', async () => {
  let { auth } = fixture()
  await auth.setPassword('owner', 'original password here', undefined)
  await expect(auth.setPassword('owner', 'replacement password here', 'incorrect')).rejects.toThrow('Current password is incorrect.')
  await auth.setPassword('owner', 'replacement password here', 'original password here')
  await expect(auth.verify('person@example.com', 'original password here')).rejects.toThrow('Email or password is incorrect.')
  expect(await auth.verify('person@example.com', 'replacement password here')).toBe('owner')
})

it('rejects weak passwords, missing accounts, and throttled attempts', async () => {
  let value = fixture()
  await expect(value.auth.setPassword('owner', 'short', undefined)).rejects.toThrow('12 to 1024')
  await expect(value.auth.verify('missing@example.com', 'any-password')).rejects.toThrow('Email or password is incorrect.')
  value.throttle()
  await expect(value.auth.verify('missing@example.com', 'any-password')).rejects.toThrow('Too many sign-in attempts.')
})
