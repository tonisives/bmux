export type RemoteIdentity = { hostId: string; generation: string; service: string }
export type RemoteUsage = { sequence: number; started: number; succeeded: number; failed: number; active: number; browserMs: number }
export type RemoteEnvelope = { version: 1; from: string; to: string; generation: string; nonce: string; expires: number; payload: string; signature: string }
export type RemoteLease = { owner: string; expires: number; generation: number }
export let envelopeText = (value: Omit<RemoteEnvelope, 'signature'>) => JSON.stringify([value.version, value.from, value.to, value.generation, value.nonce, value.expires, value.payload])
export let validEnvelope = (value: RemoteEnvelope, destination: string, generation: string, now = Date.now()) => value.version === 1 && value.to === destination && value.generation === generation && typeof value.from === 'string' && typeof value.nonce === 'string' && value.nonce.length >= 16 && value.nonce.length <= 128 && typeof value.payload === 'string' && value.payload.length <= 131072 && typeof value.signature === 'string' && value.signature.length <= 256 && Number.isFinite(value.expires) && value.expires > now && value.expires <= now + 60000

export let createControlLeases = (now = Date.now) => {
  let leases = new Map<string, RemoteLease>(), generation = 0
  let get = (session: string) => { let lease = leases.get(session); if (lease && lease.expires <= now()) { leases.delete(session); return undefined }; return lease }
  let acquire = (session: string, owner: string, takeover = false) => {
    let current = get(session)
    if (current && current.owner !== owner && !takeover) throw new Error('CONTROL_HELD')
    let lease = { owner, expires: now() + 30000, generation: ++generation }
    leases.set(session, lease); return lease
  }
  let assert = (session: string, owner?: string, expected?: number) => {
    let current = get(session)
    if (current && (current.owner !== owner || expected !== undefined && current.generation !== expected)) throw new Error('CONTROL_HELD')
    if (owner && !current) throw new Error('CONTROL_EXPIRED')
  }
  let renew = (session: string, owner: string, expected: number) => { assert(session, owner, expected); let lease = get(session)!; lease.expires = now() + 30000; return lease }
  let release = (session: string, owner?: string) => { if (!owner || get(session)?.owner === owner) leases.delete(session) }
  let disconnect = (owner: string) => { for (let [session, lease] of leases) if (lease.owner === owner) leases.delete(session) }
  return { get, acquire, assert, renew, release, disconnect }
}
