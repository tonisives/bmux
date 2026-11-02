import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { Pool } from 'pg'

let derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))
})
let normalize = (email: string) => email.trim().toLowerCase()
let matches = async (password: string, salt: string, hash: string) => {
  let actual = await derive(password, salt), expected = Buffer.from(hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export class EmailAuthError extends Error {}

export let createEmailAuth = (pool: Pool) => {
  let verify = async (email: unknown, password: unknown): Promise<string> => {
    if (typeof email !== 'string' || email.length > 320 || typeof password !== 'string' || !password || password.length > 1024) throw new EmailAuthError('Email or password is incorrect.')
    email = normalize(email)
    let attempts = await pool.query(`INSERT INTO bmux_password_attempts(email,attempts,expires) VALUES($1,1,now()+interval '15 minutes')
      ON CONFLICT(email) DO UPDATE SET attempts=CASE WHEN bmux_password_attempts.expires<now() THEN 1 ELSE bmux_password_attempts.attempts+1 END,
      expires=CASE WHEN bmux_password_attempts.expires<now() THEN now()+interval '15 minutes' ELSE bmux_password_attempts.expires END RETURNING attempts`, [email])
    if (attempts.rows[0].attempts > 10) throw new EmailAuthError('Too many sign-in attempts. Try again in 15 minutes.')
    let result = await pool.query('SELECT p.owner,p.salt,p.password_hash FROM bmux_passwords p JOIN bmux_accounts a ON a.owner=p.owner AND lower(a.email)=p.email WHERE p.email=$1', [email])
    let row = result.rows[0]
    let valid = await matches(password, row?.salt ?? 'missing-account', row?.password_hash ?? '0'.repeat(128))
    if (!row || !valid) throw new EmailAuthError('Email or password is incorrect.')
    return row.owner
  }
  let status = async (owner: string) => {
    let result = await pool.query('SELECT 1 FROM bmux_passwords WHERE owner=$1', [owner])
    return { passwordEnabled: (result.rowCount ?? 0) > 0 }
  }
  let setPassword = async (owner: string, password: unknown, currentPassword: unknown) => {
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new EmailAuthError('Use a password with 12 to 1024 characters.')
    let current = await pool.query('SELECT salt,password_hash FROM bmux_passwords WHERE owner=$1', [owner])
    let row = current.rows[0]
    if (row && (typeof currentPassword !== 'string' || currentPassword.length > 1024 || !await matches(currentPassword, row.salt, row.password_hash))) throw new EmailAuthError('Current password is incorrect.')
    let salt = randomBytes(32).toString('hex'), hash = (await derive(password, salt)).toString('hex')
    let result = await pool.query(`INSERT INTO bmux_passwords(owner,email,salt,password_hash)
      SELECT owner,lower(email),$2,$3 FROM bmux_accounts WHERE owner=$1
      ON CONFLICT(owner) DO UPDATE SET email=excluded.email,salt=excluded.salt,password_hash=excluded.password_hash
      WHERE bmux_passwords.password_hash IS NOT DISTINCT FROM $4 RETURNING owner`, [owner, salt, hash, row?.password_hash ?? null])
    if (!result.rowCount) throw new EmailAuthError('Password changed. Try again.')
  }
  return { verify, status, setPassword }
}
