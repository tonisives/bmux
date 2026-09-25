import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { remoteIdentity } from '../src/main/remote-identity'

let [action, ...args] = process.argv.slice(2)
let get = (name: string) => { let index = args.indexOf(`--${name}`); let value = index >= 0 ? args[index + 1] : undefined; if (!value || value.startsWith('--')) throw new Error(`--${name} is required`); return value }
if (action === 'approve' || action === 'revoke') {
  let file = get('config')
  if (fs.statSync(file).mode & 0o077) throw new Error('Configuration must have mode 600')
  let config = JSON.parse(fs.readFileSync(file, 'utf8'))
  config.approvedClients ??= {}
  if (action === 'approve') {
    let key = JSON.parse(fs.readFileSync(get('key'), 'utf8'))
    if (key.kty !== 'OKP' || key.crv !== 'Ed25519' || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x)) throw new Error('Invalid public key')
    let id = createHash('sha256').update(key.x).digest('hex')
    if (get('fingerprint') !== id) throw new Error('Fingerprint does not match')
    config.approvedClients[id] = { kty: key.kty, crv: key.crv, x: key.x }
  } else delete config.approvedClients[get('fingerprint')]
  fs.writeFileSync(`${file}.pending`, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' })
  fs.renameSync(`${file}.pending`, file)
  process.stdout.write('Device authorization updated.\n')
} else if (action === 'enroll') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  let owner = get('owner'), service = get('service'), output = path.resolve(get('output')), url = get('url')
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(service)) throw new Error('Invalid service name')
  if (fs.existsSync(output)) throw new Error('Output file already exists')
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  let identityFile = `${output}.identity.pem`, identity = remoteIdentity(identityFile)
  let token = randomBytes(32).toString('hex')
  let pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  try {
    await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    await pool.query('INSERT INTO bmux_services (id,owner,token_hash,public_key) VALUES ($1,$2,$3,$4)', [service, owner, createHash('sha256').update(token).digest('hex'), identity.publicKey])
    fs.writeFileSync(output, JSON.stringify({ url, token, identityFile, approvedClients: {} }, null, 2), { mode: 0o600, flag: 'wx' })
    process.stdout.write(`Service enrolled. Private configuration: ${output}\nHost fingerprint: ${identity.id}\n`)
  } finally { await pool.end() }
} else throw new Error('Usage: remote/admin.ts enroll|approve|revoke --help (see docs/remote-host.md)')
