import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createFingerprintCatalog } from '../src/main/fingerprint-catalog'
import { initialModel } from '../src/main/model'
import { fingerprintSettings, parseFingerprint } from '../src/shared/fingerprint'
import type { FingerprintChange, FingerprintRecord } from '../src/shared/fingerprint'

let origin = 'https://relay.example'
let signal = new AbortController().signal
let preset = parseFingerprint({ version:1,id:'fingerprint_test',name:'Phone',viewport:{width:400,height:800} })
let fixture = () => {
  let owners: Record<string,string> = { first:'account', second:'account', third:'another-account' }
  let libraries = new Map<string,Map<string,FingerprintRecord>>()
  vi.stubGlobal('fetch',vi.fn(async (_endpoint: URL, request: RequestInit) => {
    let token = new Headers(request.headers).get('Authorization')?.slice(7) ?? ''
    let owner = owners[token], library = libraries.get(owner) ?? new Map<string,FingerprintRecord>()
    libraries.set(owner,library)
    if (!request.body) return Response.json({ owner,records:[...library.values()] })
    let input = JSON.parse(String(request.body)) as { owner:string; change:FingerprintChange }
    if (input.owner !== owner) return Response.json({}, { status:401 })
    let current = library.get(input.change.id)
    if ((current?.revision ?? null) !== input.change.revision) {
      if (JSON.stringify(current?.value) === JSON.stringify(input.change.value)) return Response.json({ record:current })
      return Response.json({ record:current },{ status:409 })
    }
    let record = { id:input.change.id,revision:randomUUID(),value:input.change.value }
    library.set(record.id,record)
    return Response.json({ record })
  }))
  return libraries
}
afterEach(() => vi.unstubAllGlobals())

it('shares existing presets across service keys and keeps other accounts separate', async () => {
  fixture()
  let model = initialModel()
  model.fingerprints = [preset]
  model.profiles[0].fingerprintLock = { scope:'',value:preset }
  let a = createFingerprintCatalog(model,vi.fn())
  a.bind(origin,'first')
  await a.synchronize(origin,'first',signal)
  expect(model.fingerprints).toBeUndefined()
  expect(model.profiles[0].fingerprintLock?.scope).toBe(a.scope())
  let b = createFingerprintCatalog(initialModel(),vi.fn())
  b.bind(origin,'second')
  await b.synchronize(origin,'second',signal)
  expect(b.profiles()).toEqual([preset])
  a.bind(origin,'third')
  await a.synchronize(origin,'third',signal)
  expect(a.profiles()).toEqual([])
  expect(model.profiles[0].fingerprintLock?.value).toEqual(preset)
})

it('preserves the offline draft on a stale write and retains a lock after catalog deletion', async () => {
  let libraries = fixture()
  let model = initialModel(), a = createFingerprintCatalog(model,vi.fn())
  a.bind(origin,'first')
  await a.synchronize(origin,'first',signal)
  a.update(preset.id,preset)
  await a.synchronize(origin,'first',signal)
  model.profiles[0].fingerprintLock = { scope:a.scope(),value:preset }
  let offline = { ...preset,name:'Offline draft' }
  a.update(preset.id,offline)
  a = createFingerprintCatalog(structuredClone(model),vi.fn())
  a.bind(origin,'first')
  expect(a.profiles()).toEqual([offline])
  let b = createFingerprintCatalog(initialModel(),vi.fn())
  b.bind(origin,'second')
  await b.synchronize(origin,'second',signal)
  b.update(preset.id,null)
  await b.synchronize(origin,'second',signal)
  await a.synchronize(origin,'first',signal)
  expect(a.conflicts()).toEqual([preset.id])
  expect(a.profiles()).toEqual([offline])
  expect(libraries.get('account')?.get(preset.id)?.value).toBeNull()
  a.discard(preset.id)
  expect(a.profiles()).toEqual([])
  expect(a.conflicts()).toEqual([])
})

it('compares settings independently of names and serialized key order', () => {
  expect(fingerprintSettings(preset)).toBe(fingerprintSettings({ ...preset,name:'Renamed',viewport:{height:800,width:400} }))
  expect(fingerprintSettings(preset)).not.toBe(fingerprintSettings({ ...preset,viewport:{height:800,width:401} }))
})
