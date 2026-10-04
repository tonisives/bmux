type Snapshot = { image: Buffer; width: number; height: number }

// Viewport JPEGs only: no HTML, full-page images, disk writes or profile sharing.
// The global byte cap covers compressed storage; only the active swipe decodes.
export let createSwipeSnapshotCache = (maxBytes = 16 * 1024 * 1024, perTab = 4) => {
  let entries = new Map<string, Snapshot & { tab: number }>(), bytes = 0
  let remove = (key: string) => { let entry = entries.get(key); if (entry) bytes -= entry.image.byteLength; entries.delete(key) }
  return {
    get bytes() { return bytes },
    get size() { return entries.size },
    set: (tab: number, entry: number, snapshot: Snapshot) => {
      let key = `${tab}:${entry}`
      remove(key)
      if (snapshot.image.byteLength > Math.min(maxBytes, 512 * 1024)) return
      entries.set(key, { ...snapshot, tab }); bytes += snapshot.image.byteLength
      let siblings = [...entries].filter(([, value]) => value.tab === tab)
      while (siblings.length > perTab) remove(siblings.shift()![0])
      while (bytes > maxBytes) remove(entries.keys().next().value!)
    },
    get: (tab: number, entry: number, width: number, height: number) => {
      let key = `${tab}:${entry}`, value = entries.get(key)
      if (!value || value.width !== width || value.height !== height) return
      entries.delete(key); entries.set(key, value)
      return value.image
    },
    prune: (tab: number, history: number[]) => { for (let [key, value] of entries) if (value.tab === tab && !history.includes(Number(key.split(':')[1]))) remove(key) },
    clear: (tab: number) => { for (let [key, value] of entries) if (value.tab === tab) remove(key) },
  }
}

export let swipeSnapshots = createSwipeSnapshotCache()
