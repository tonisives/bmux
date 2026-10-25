import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'

type Host = { owner: string; service: string; id: string; generation: string; sessions?: { id: string; panes: { id: string }[] }[] }
export let recordHostAttention = async (pool: Pool, host: Host, message: Record<string, unknown>) => {
  let { session, pane, episode, reason } = message
  if (![session,pane,episode].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128) || !['help','challenge','account-warning','rate-limit'].includes(String(reason))) throw new Error('Invalid attention target')
  let revision = message.revision ?? 1, status = message.status ?? 'pending', attempt = message.attempt
  if (!Number.isSafeInteger(revision) || Number(revision) < 1 || Number(revision) > 1e9 || !['pending','verifying','resolved','cancelled','expired'].includes(String(status))) throw new Error('Invalid attention revision')
  if (attempt !== undefined) {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) throw new Error('Invalid verification attempt')
    let value = attempt as Record<string,unknown>
    if (!['id','request'].every(key => typeof value[key] === 'string' && /^[a-f0-9-]{36}$/.test(String(value[key]))) || !Number.isFinite(value.acknowledgedAt) || value.completedAt !== undefined && (!Number.isFinite(value.completedAt) || Number(value.completedAt) < Number(value.acknowledgedAt)) || value.outcome !== undefined && !['verified','verification-failed','verification-timeout'].includes(String(value.outcome)) || value.code !== undefined && !/^[A-Z0-9_]{1,64}$/.test(String(value.code))) throw new Error('Invalid verification attempt')
    attempt = { id:value.id,request:value.request,acknowledgedAt:value.acknowledgedAt,...(value.completedAt === undefined ? {} : {completedAt:value.completedAt}),...(value.outcome === undefined ? {} : {outcome:value.outcome}),...(value.code === undefined ? {} : {code:value.code}) }
  }
  if (status === 'verifying' && !attempt || message.revision !== undefined && status === 'resolved' && (attempt as {outcome?:string}|undefined)?.outcome !== 'verified') throw new Error('Unverified attention outcome')
  let client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7402))', [JSON.stringify([host.service,host.id,host.generation,episode])])
    let existing = (await client.query('SELECT * FROM bmux_attention WHERE service=$1 AND host=$2 AND generation=$3 AND episode=$4 FOR UPDATE', [host.service,host.id,host.generation,episode])).rows[0]
    if (existing && (existing.session !== session || existing.pane !== pane || existing.reason !== reason)) throw new Error('Attention target changed')
    if (!existing && !host.sessions?.some(item => item.id === session && item.panes.some(item => item.id === pane))) throw new Error('Invalid attention target')
    let current = existing
    if (!existing) current = (await client.query("INSERT INTO bmux_attention(id,owner,service,host,generation,session,pane,episode,reason,revision,status,attempt,resolved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $11 IN ('resolved','cancelled','expired') THEN now() ELSE NULL END) RETURNING *", [randomUUID(),host.owner,host.service,host.id,host.generation,session,pane,episode,reason,revision,status,attempt ?? null])).rows[0]
    else if (Number(revision) > existing.revision && !['resolved','cancelled','expired'].includes(existing.status)) current = (await client.query("UPDATE bmux_attention SET revision=$2,status=$3,attempt=$4,resolved_at=CASE WHEN $3 IN ('resolved','cancelled','expired') THEN now() ELSE NULL END WHERE id=$1 RETURNING *", [existing.id,revision,status,attempt ?? null])).rows[0]
    if (current.status === 'pending') await client.query("INSERT INTO bmux_push_outbox(attention_id,owner,device,event_revision) SELECT $1,owner,device,$3 FROM bmux_push_devices WHERE owner=$2 AND enabled ON CONFLICT(attention_id,owner,device) DO UPDATE SET event_revision=excluded.event_revision,attempts=0,receipt_id=NULL,token_hash=NULL,sent_at=NULL,next_check_at=now() WHERE bmux_push_outbox.event_revision<excluded.event_revision", [current.id,host.owner,current.revision])
    await client.query('COMMIT')
    return { type:'attention-recorded',episode,id:current.id,revision:current.revision }
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
