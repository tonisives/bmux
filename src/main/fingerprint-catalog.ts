import { createHash } from 'node:crypto'
import { parseFingerprint, validFingerprintId } from '../shared/fingerprint'
import type { FingerprintCatalog, FingerprintChange, FingerprintProfile, FingerprintRecord } from '../shared/fingerprint'
import type { Model } from '../shared/types'

let hash = (value: string) => createHash('sha256').update(value).digest('hex')
let cleanRecord = (record: FingerprintRecord) => {
  if (!validFingerprintId(record.id) || !/^[a-f0-9-]{36}$/.test(record.revision)) throw new Error('Invalid relay fingerprint record')
  let value = record.value === null ? null : parseFingerprint(record.value)
  if (value && value.id !== record.id) throw new Error('Invalid relay fingerprint identity')
  return { ...record, value }
}

export let createFingerprintCatalog = (model: Model, persist: () => void) => {
  let scope = '', binding = ''
  let sync = () => model.fingerprintSync ??= { scopes: {} }
  let active = () => scope ? sync().scopes[scope] : undefined
  let find = (id: string, inScope = scope): FingerprintProfile | undefined => {
    if (!inScope) return model.fingerprints?.find(item => item.id === id)
    let library = model.fingerprintSync?.scopes[inScope]
    let value = library?.pending[id] ?? library?.records[id]
    return value?.value ?? undefined
  }
  let profiles = () => {
    let library = active()
    if (!library) return model.fingerprints ?? []
    return [...new Set([...Object.keys(library.records), ...Object.keys(library.pending)])].flatMap(id => find(id) ?? [])
  }
  let update = (id: string, value: FingerprintProfile | null) => {
    let library = active()
    if (library) {
      let existing = library.pending[id]
      let revision = existing ? existing.revision : library.records[id]?.revision ?? null
      let original = !value && revision === null ? existing?.value ?? existing?.original : undefined
      library.pending[id] = { id, value, revision, ...(original ? { original } : {}), ...(existing?.conflict ? { conflict:true } : {}) }
    } else {
      let records = (model.fingerprints ?? []).filter(item => item.id !== id)
      if (value && records.length >= 100) throw new Error('Fingerprint profile limit reached')
      model.fingerprints = value ? [...records,value] : records
    }
    persist()
  }
  let bind = (origin: string, token: string) => {
    binding = hash(JSON.stringify([origin,token]))
    scope = model.fingerprintSync?.binding?.key === binding ? model.fingerprintSync.binding.scope : ''
  }
  let disconnect = () => { scope = ''; binding = '' }
  let refreshLocks = (id: string, value: FingerprintProfile | null) => {
    if (value) for (let profile of model.profiles) {
      if (profile.fingerprintLock?.scope === scope && profile.fingerprintLock.value.id === id) profile.fingerprintLock.value = value
    }
  }
  let synchronize = async (origin: string, token: string, signal: AbortSignal) => {
    let key = binding, url = new URL('/api/host/fingerprints',origin)
    let request = (owner?: string, change?: FingerprintChange) => fetch(url, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(change ? { method: 'POST', body: JSON.stringify({ owner,change }) } : {}), redirect: 'error', signal: AbortSignal.any([signal,AbortSignal.timeout(10000)]),
    })
    let response = await request()
    if (!response.ok) throw new Error('Fingerprint sync unavailable')
    let result = await response.json() as FingerprintCatalog
    if (key !== binding || signal.aborted) return
    if (typeof result.owner !== 'string' || !result.owner || !Array.isArray(result.records)) throw new Error('Invalid relay fingerprint catalog')
    let records = Object.fromEntries(result.records.map(item => [item.id,cleanRecord(item)]))
    let nextScope = hash(JSON.stringify([origin,result.owner]))
    let previous = model.fingerprintSync?.scopes[nextScope]
    let changed = nextScope !== scope || JSON.stringify(previous?.records) !== JSON.stringify(records)
    scope = nextScope
    let state = sync()
    state.binding = { key, scope }
    let library = state.scopes[scope] ??= { records: {}, pending: {} }
    library.records = records
    for (let record of Object.values(records)) refreshLocks(record.id,record.value)
    if (model.fingerprints?.length) {
      for (let value of model.fingerprints) {
        if (!library.pending[value.id] && JSON.stringify(records[value.id]?.value) !== JSON.stringify(value)) library.pending[value.id] = { id:value.id, value, revision:null }
        for (let profile of model.profiles) if (profile.fingerprintLock?.scope === '' && profile.fingerprintLock.value.id === value.id) profile.fingerprintLock.scope = scope
        for (let session of model.sessions) for (let window of session.windows) for (let pane of window.panes) {
          if (pane.fingerprint?.scope === '' && pane.fingerprint.id === value.id) pane.fingerprint.scope = scope
        }
      }
      delete model.fingerprints
      changed = true
    }
    if (changed) persist()
    for (let pending of Object.values(library.pending)) {
      if (key !== binding || signal.aborted) return
      if (pending.conflict) continue
      let response = await request(result.owner,pending)
      if (!response.ok && response.status !== 409) throw new Error('Fingerprint sync unavailable')
      let { record } = await response.json() as { record?: FingerprintRecord }
      if (key !== binding || signal.aborted) return
      let current = library.pending[pending.id]
      if (record) library.records[pending.id] = cleanRecord(record)
      if (response.status === 409) {
        if (current) {
          let latest = library.records[pending.id]
          if (current.original && latest && JSON.stringify(latest.value) === JSON.stringify(current.original)) current.revision = latest.revision
          else current.conflict = true
        }
      } else if (current === pending) {
        delete library.pending[pending.id]
        refreshLocks(pending.id,library.records[pending.id].value)
      } else if (current) current.revision = library.records[pending.id].revision
      persist()
    }
  }
  return {
    bind, disconnect, synchronize, find, profiles, update,
    scope: () => scope,
    conflicts: () => Object.values(active()?.pending ?? {}).filter(item => item.conflict).map(item => item.id),
    discard: (id: string) => {
      let library = active()
      if (library?.pending[id]?.conflict) { delete library.pending[id]; refreshLocks(id,library.records[id]?.value ?? null); persist() }
    },
  }
}
