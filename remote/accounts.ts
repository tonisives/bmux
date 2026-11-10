import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { ACCOUNT_PLATFORMS } from '../src/shared/managed-accounts'

export class AccountsError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export let accountText = (value: unknown, name: string, maximum = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new AccountsError(400, `Enter a valid ${name}`)
  return value.trim()
}
export let accountId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AccountsError(400, 'Invalid record ID')
  return value
}
export let accountTimezone = (value: unknown) => {
  let zone = accountText(value, 'timezone')
  try { return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone }
  catch { throw new AccountsError(400, 'Enter an IANA timezone') }
}
export let createAccounts = (pool: Pool) => {
  let api = async (owner: string, method: string, pathname: string, input: Record<string, unknown>) => {
    if (method === 'GET' && pathname === '/api/v1/accounts/overview') {
      let [projects, personas, accounts, schedules] = await Promise.all([
        pool.query('SELECT id,name,timezone FROM bmux_projects WHERE owner=$1 ORDER BY created_at,id', [owner]),
        pool.query('SELECT id,project_id,name,interests FROM bmux_personas WHERE owner=$1 ORDER BY name,id', [owner]),
        pool.query('SELECT id,persona_id,platform,handle,status FROM bmux_managed_accounts WHERE owner=$1 ORDER BY created_at,id', [owner]),
        pool.query('SELECT id,account_id,kind,job,scheduled_at,duration_minutes,status FROM bmux_account_schedules WHERE owner=$1 ORDER BY scheduled_at,id', [owner]),
      ])
      return { projects: projects.rows, personas: personas.rows, accounts: accounts.rows, schedules: schedules.rows, executionEnabled: false }
    }
    if (method !== 'POST') throw new AccountsError(405, 'Unsupported account operation')
    let id = randomUUID()
    if (pathname === '/api/v1/projects') {
      await pool.query('INSERT INTO bmux_projects(id,owner,name,timezone) VALUES($1,$2,$3,$4)', [id, owner, accountText(input.name, 'project name'), accountTimezone(input.timezone)])
    } else if (pathname === '/api/v1/personas') {
      let project = accountId(input.projectId), name = accountText(input.name, 'persona name')
      let interests = input.interests === '' || input.interests === undefined ? '' : accountText(input.interests, 'interests', 4000)
      let result = await pool.query('INSERT INTO bmux_personas(id,owner,project_id,name,interests) SELECT $1,$2,id,$4,$5 FROM bmux_projects WHERE owner=$2 AND id=$3 RETURNING id', [id, owner, project, name, interests])
      if (!result.rowCount) throw new AccountsError(404, 'Project unavailable')
    } else if (pathname === '/api/v1/accounts') {
      let persona = accountId(input.personaId), platform = accountText(input.platform, 'platform'), handle = accountText(input.handle, 'account handle')
      if (!(ACCOUNT_PLATFORMS as readonly string[]).includes(platform)) throw new AccountsError(400, 'Choose a supported platform')
      let result = await pool.query('INSERT INTO bmux_managed_accounts(id,owner,persona_id,platform,handle) SELECT $1,$2,id,$4,$5 FROM bmux_personas WHERE owner=$2 AND id=$3 RETURNING id', [id, owner, persona, platform, handle])
      if (!result.rowCount) throw new AccountsError(404, 'Persona unavailable')
    } else if (pathname === '/api/v1/schedules') {
      let account = accountId(input.accountId), kind = accountText(input.kind, 'job kind'), job = accountText(input.job, 'installed job', 200)
      if (!['warmup','post','analytics'].includes(kind)) throw new AccountsError(400, 'Choose a supported job kind')
      if (typeof input.scheduledAt !== 'string' || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt) || !Number.isFinite(Date.parse(input.scheduledAt)) || Date.parse(input.scheduledAt) <= Date.now()) throw new AccountsError(400, 'Choose a future time with a timezone')
      let duration = input.durationMinutes
      if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 180) throw new AccountsError(400, 'Duration must be 1 to 180 minutes')
      let inputs = input.inputs ?? {}
      if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || JSON.stringify(inputs).length > 16000) throw new AccountsError(400, 'Invalid job inputs')
      let result = await pool.query('INSERT INTO bmux_account_schedules(id,owner,account_id,kind,job,inputs,scheduled_at,duration_minutes) SELECT $1,$2,id,$4,$5,$6,$7,$8 FROM bmux_managed_accounts WHERE owner=$2 AND id=$3 RETURNING id', [id, owner, account, kind, job, JSON.stringify(inputs), input.scheduledAt, duration])
      if (!result.rowCount) throw new AccountsError(404, 'Account unavailable')
    } else if (/^\/api\/v1\/schedules\/[^/]+\/cancel$/.test(pathname)) {
      let result = await pool.query("UPDATE bmux_account_schedules SET status='cancelled' WHERE owner=$1 AND id=$2 RETURNING id", [owner, accountId(pathname.split('/')[4])])
      if (!result.rowCount) throw new AccountsError(404, 'Schedule unavailable')
      return { cancelled: true }
    } else throw new AccountsError(404, 'Account operation unavailable')
    return { id }
  }
  return { api }
}
