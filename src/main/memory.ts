import type { ProcessMetric, WebContents } from 'electron'

export type MemoryTab = {
  tabId: string; paneId: string; windowId: string; sessionId: string; profileId: string
  webContentsId: number | null; visible: boolean; backgroundThrottling: boolean | null; busy: boolean
}
type MemoryOwner = { webContentsId: number; type: string; processIds: number[] }
type MemoryProcess = {
  pid: number; creationTime: number; type: string; workingSetBytes: number
  deltaBytes: number | null; webContentsIds: number[]; tabIds: string[]; profileIds: string[]
}
export type MemorySample = {
  capturedAt: number; comparedTo: number | null; totalWorkingSetBytes: number; deltaBytes: number | null
  processes: MemoryProcess[]; tabs: (MemoryTab & { processIds: number[] })[]; contents: MemoryOwner[]
  profiles: { profileId: string; processIds: number[]; workingSetBytes: number }[]
}

// Frame getters can throw while a renderer exits or a frame navigates away.
export let memoryOwners = (contents: WebContents[]): MemoryOwner[] => contents.flatMap(content => {
  if (content.isDestroyed()) return []
  let processIds = new Set<number>()
  let add = (pid: number) => { if (pid > 0) processIds.add(pid) }
  try { add(content.getOSProcessId()) } catch { /* Renderer exited. */ }
  try {
    for (let frame of content.mainFrame.framesInSubtree) {
      try { add(frame.osProcessId) } catch { /* Frame detached. */ }
    }
  } catch { /* Main frame is unavailable. */ }
  try { return [{ webContentsId: content.id, type: content.getType(), processIds: [...processIds] }] }
  catch { return [] }
})

export let memorySample = (metrics: ProcessMetric[], owners: MemoryOwner[], tabs: MemoryTab[], previous?: MemorySample, capturedAt = Date.now()): MemorySample => {
  let uniqueMetrics = [...new Map(metrics.map(metric => [metric.pid, metric])).values()]
  let livePids = new Set(uniqueMetrics.map(metric => metric.pid))
  let contents = owners.map(owner => ({ ...owner, processIds: [...new Set(owner.processIds)].filter(pid => livePids.has(pid)) }))
  let linkedTabs = tabs.map(tab => ({ ...tab, processIds: contents.find(owner => owner.webContentsId === tab.webContentsId)?.processIds ?? [] }))
  let processes = uniqueMetrics.map(metric => {
    let prior = previous?.processes.find(row => row.pid === metric.pid && row.creationTime === metric.creationTime)
    let related = linkedTabs.filter(tab => tab.processIds.includes(metric.pid))
    let workingSetBytes = metric.memory.workingSetSize * 1024
    return {
      pid: metric.pid, creationTime: metric.creationTime, type: metric.type, workingSetBytes,
      deltaBytes: prior ? workingSetBytes - prior.workingSetBytes : null,
      webContentsIds: contents.filter(owner => owner.processIds.includes(metric.pid)).map(owner => owner.webContentsId),
      tabIds: related.map(tab => tab.tabId), profileIds: [...new Set(related.map(tab => tab.profileId))],
    }
  }).sort((left, right) => right.workingSetBytes - left.workingSetBytes || left.pid - right.pid)
  let totalWorkingSetBytes = processes.reduce((sum, row) => sum + row.workingSetBytes, 0)
  let profiles = [...new Set(tabs.map(tab => tab.profileId))].map(profileId => {
    let related = processes.filter(row => row.profileIds.includes(profileId))
    return { profileId, processIds: related.map(row => row.pid), workingSetBytes: related.reduce((sum, row) => sum + row.workingSetBytes, 0) }
  })
  return { capturedAt, comparedTo: previous?.capturedAt ?? null, totalWorkingSetBytes, deltaBytes: previous ? totalWorkingSetBytes - previous.totalWorkingSetBytes : null, processes, tabs: linkedTabs, contents, profiles }
}

export let MEMORY_INTERVAL_MS = 30_000
export let MEMORY_HISTORY_LIMIT = 120
export let createMemoryDiagnostics = (collect: (previous?: MemorySample) => MemorySample) => {
  let history: MemorySample[] = []
  let record = () => {
    let sample = collect(history.at(-1))
    history.push(sample)
    if (history.length > MEMORY_HISTORY_LIMIT) history.shift()
  }
  let report = (includeHistory = false) => ({
    schemaVersion: 1,
    metric: 'working-set-bytes',
    intervalMs: MEMORY_INTERVAL_MS,
    historyLimit: MEMORY_HISTORY_LIMIT,
    notes: [
      'Process working sets include shared resident memory; their sum is not macOS Activity Monitor memory footprint.',
      'Shared renderers are counted once in the total. Profile totals may overlap and exclude processes without a mapped tab.',
      'Frame ownership is best effort during navigation. Unmapped processes remain in the total.',
      'Deltas compare with the previous periodic sample. New or reused PIDs have a null process delta.',
    ],
    current: collect(history.at(-1)),
    ...(includeHistory ? { history: [...history] } : {}),
  })
  return { record, report }
}
