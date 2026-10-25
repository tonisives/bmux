import type { Pool } from 'pg'

export type StreamLease = { connection: string; owner: string; host: string; generation: string; viewer: string; pane: string; expires: Date }
export let createStreamLeases = (pool: Pool, managed: boolean) => {
  let active = async (owner: string) => !managed || !!(await pool.query('SELECT 1 FROM bmux_entitlements WHERE owner=$1 AND expires>now()', [owner])).rowCount
  let status = async (owner: string) => {
    let entitlement = managed ? (await pool.query('SELECT max_streams FROM bmux_entitlements WHERE owner=$1 AND expires>now()', [owner])).rows[0] : {max_streams:100}
    let count = Number((await pool.query('SELECT count(*) FROM bmux_stream_leases WHERE owner=$1 AND expires>now()', [owner])).rows[0].count)
    return {status:entitlement ? 'active' : 'inactive',canStream:!!entitlement,streamLimit:entitlement?.max_streams ?? 2,activeStreams:count}
  }
  let acquire = async (lease: Omit<StreamLease, 'expires'>, renew = false) => {
    let client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,7401))', [lease.owner])
      let entitlement = managed ? (await client.query('SELECT max_streams FROM bmux_entitlements WHERE owner=$1 AND expires>now()', [lease.owner])).rows[0] : { max_streams: 100 }
      if (!entitlement) throw new Error('Connect relay in Account settings to watch this computer')
      await client.query('DELETE FROM bmux_stream_leases WHERE expires<=now()')
      let existing = (await client.query('SELECT * FROM bmux_stream_leases WHERE connection=$1 FOR UPDATE', [lease.connection])).rows[0] as StreamLease | undefined
      if (renew && !existing) throw new Error('Invalid stream permit')
      if (existing && (existing.owner !== lease.owner || existing.host !== lease.host || existing.generation !== lease.generation || existing.viewer !== lease.viewer || existing.pane !== lease.pane)) throw new Error('Invalid stream permit')
      let count = Number((await client.query('SELECT count(*) FROM bmux_stream_leases WHERE owner=$1', [lease.owner])).rows[0].count)
      if (!existing && count >= entitlement.max_streams) throw new Error('Both live views are in use. Disconnect a view in Account settings.')
      await client.query("INSERT INTO bmux_stream_leases(connection,owner,host,generation,viewer,pane,expires) VALUES($1,$2,$3,$4,$5,$6,now()+interval '20 seconds') ON CONFLICT(connection) DO UPDATE SET expires=excluded.expires", [lease.connection,lease.owner,lease.host,lease.generation,lease.viewer,lease.pane])
      await client.query('COMMIT')
      return { expires: Date.now() + 20000 }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  let release = (host: string, generation: string, connection?: string, viewer?: string) => pool.query('DELETE FROM bmux_stream_leases WHERE host=$1 AND generation=$2 AND ($3::text IS NULL OR connection=$3) AND ($4::text IS NULL OR viewer=$4) RETURNING *', [host,generation,connection ?? null,viewer ?? null])
  let list = async (owner: string) => (await pool.query('SELECT connection,host,generation,pane,viewer,started_at AS "startedAt",expires FROM bmux_stream_leases WHERE owner=$1 AND expires>now() ORDER BY started_at,connection', [owner])).rows
  let revoke = async (owner: string, connection: string) => (await pool.query('DELETE FROM bmux_stream_leases WHERE owner=$1 AND connection=$2 RETURNING *', [owner,connection])).rows[0] as StreamLease | undefined
  let expire = async () => (await pool.query(`DELETE FROM bmux_stream_leases l WHERE expires<=now() ${managed ? "OR NOT EXISTS(SELECT 1 FROM bmux_entitlements e WHERE e.owner=l.owner AND e.expires>now())" : ''} RETURNING *`)).rows as StreamLease[]
  return { active, status, acquire, release, list, revoke, expire }
}
