import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { parseFingerprint, validFingerprintId } from '../src/shared/fingerprint'
import type { FingerprintChange, FingerprintRecord } from '../src/shared/fingerprint'

export let fingerprintCatalog = (pool: Pool) => ({
  list: async (owner: string) => ({
    owner,
    records: (await pool.query<FingerprintRecord>('SELECT id,revision,value FROM bmux_fingerprints WHERE owner=$1 ORDER BY id', [owner])).rows,
  }),
  change: async (owner: string, input: unknown) => {
    let item = input as Partial<FingerprintChange> | null
    if (!item || !validFingerprintId(item.id) || !(item.revision === null || typeof item.revision === 'string' && /^[a-f0-9-]{36}$/.test(item.revision))) return { status: 400, body: { error: 'Invalid fingerprint change' } }
    let value
    try { value = item.value === null ? null : parseFingerprint(item.value) }
    catch { return { status: 400, body: { error: 'Invalid fingerprint profile' } } }
    if (value && value.id !== item.id) return { status: 400, body: { error: 'Invalid fingerprint change' } }
    let revision = randomUUID()
    let args = [owner, item.id, revision, value]
    let changed = item.revision === null
      ? await pool.query<FingerprintRecord>('INSERT INTO bmux_fingerprints(owner,id,revision,value) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id,revision,value', args)
      : await pool.query<FingerprintRecord>('UPDATE bmux_fingerprints SET revision=$3,value=$4 WHERE owner=$1 AND id=$2 AND revision=$5 RETURNING id,revision,value', [...args, item.revision])
    if (changed.rows[0]) return { status: 200, body: { record: changed.rows[0] } }
    let current = (await pool.query<FingerprintRecord>('SELECT id,revision,value FROM bmux_fingerprints WHERE owner=$1 AND id=$2', [owner,item.id])).rows[0]
    if (current && JSON.stringify(current.value === null ? null : parseFingerprint(current.value)) === JSON.stringify(value)) return { status: 200, body: { record: current } }
    return { status: 409, body: { error: 'Fingerprint changed. Reload it or save a copy.', record: current } }
  },
})
