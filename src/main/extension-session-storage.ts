export let createExtensionSessionStorage = () => {
  let stores = new Map<string, Record<string, unknown>>()
  let read = (id: string) => stores.get(id) ?? Object.create(null) as Record<string, unknown>
  let get = (id: string, keys?: string | string[] | Record<string, unknown> | null) => {
    let source = read(id), result: Record<string, unknown> = Object.create(null)
    for (let key of keys == null ? Object.keys(source) : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)) {
      if (Object.hasOwn(source, key)) result[key] = source[key]
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) result[key] = keys[key]
    }
    return structuredClone(result)
  }
  let bytes = (items: Record<string, unknown>) => Object.entries(items).reduce((size, [key, value]) => size + Buffer.byteLength(key) + Buffer.byteLength(JSON.stringify(value)), 0)
  let update = (id: string, items: Record<string, unknown>, remove: string[] = []) => {
    let old = read(id), next = Object.assign(Object.create(null), old, JSON.parse(JSON.stringify(items))) as Record<string, unknown>
    for (let key of remove) delete next[key]
    if (bytes(next) > 10485760) throw new Error('Session storage quota exceeded')
    let changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = Object.create(null)
    for (let key of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (JSON.stringify(old[key]) === JSON.stringify(next[key])) continue
      changes[key] = { ...(Object.hasOwn(old, key) ? { oldValue: old[key] } : {}), ...(Object.hasOwn(next, key) ? { newValue: next[key] } : {}) }
    }
    stores.set(id, next)
    return structuredClone(changes)
  }
  return { get, update, bytes: (id: string, keys?: string | string[] | null) => bytes(get(id, keys)), keys: (id: string) => Object.keys(read(id)), clear: (id: string) => update(id, {}, Object.keys(read(id))), unload: (id: string) => stores.delete(id) }
}
