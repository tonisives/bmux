import { describe, expect, it } from 'vitest'
import type { ProcessMetric, WebContents } from 'electron'
import { createMemoryDiagnostics, memoryOwners, memorySample, MEMORY_HISTORY_LIMIT } from '../src/main/memory'
import type { MemoryTab } from '../src/main/memory'

let metric = (pid: number, size: number, creationTime = 1): ProcessMetric => ({ pid, creationTime, type: 'Tab', memory: { workingSetSize: size, peakWorkingSetSize: size }, cpu: { percentCPUUsage: 0, cumulativeCPUUsage: 0, idleWakeupsPerSecond: 0 } })
let tab = (tabId: string, webContentsId: number, profileId = 'personal'): MemoryTab => ({ tabId, webContentsId, profileId, paneId: 'pane', windowId: 'window', sessionId: 'session', visible: false, backgroundThrottling: true, busy: false })

describe('memory diagnostics', () => {
  it('counts shared renderers once, includes subframes and keeps unmapped processes', () => {
    let sample = memorySample([metric(10, 100), metric(11, 40), metric(12, 20)], [
      { webContentsId: 1, type: 'browserView', processIds: [10, 11, 11, 99] },
      { webContentsId: 2, type: 'browserView', processIds: [10] },
    ], [tab('one', 1), tab('two', 2)])
    expect(sample.totalWorkingSetBytes).toBe(160 * 1024)
    expect(sample.processes[0].tabIds).toEqual(['one', 'two'])
    expect(sample.tabs[0].processIds).toEqual([10, 11])
    expect(sample.profiles[0].workingSetBytes).toBe(140 * 1024)
    expect(sample.processes[2].tabIds).toEqual([])
  })

  it('compares process identities, includes exits in totals, and marks new processes', () => {
    let before = memorySample([metric(1, 100), metric(2, 80), metric(3, 20)], [], [], undefined, 1000)
    let after = memorySample([metric(1, 120), metric(2, 30, 2), metric(4, 10)], [], [], before, 2000)
    expect(after.comparedTo).toBe(1000)
    expect(after.deltaBytes).toBe(-40 * 1024)
    expect(after.processes.map(row => row.deltaBytes)).toEqual([20 * 1024, null, null])
  })

  it('keeps only periodic history, bounded to the latest samples', () => {
    let time = 0
    let diagnostics = createMemoryDiagnostics(previous => memorySample([], [], [], previous, ++time))
    expect(diagnostics.report().current.deltaBytes).toBeNull()
    for (let index = 0; index < MEMORY_HISTORY_LIMIT + 5; index++) diagnostics.record()
    let report = diagnostics.report(true)
    expect(report.history).toHaveLength(MEMORY_HISTORY_LIMIT)
    expect(report.history![0].capturedAt).toBe(7)
    expect(report.current.comparedTo).toBe(report.history!.at(-1)!.capturedAt)
    expect(diagnostics.report(true).history).toEqual(report.history)
    expect(diagnostics.report()).not.toHaveProperty('history')
  })

  it('tolerates detached frames and destroyed contents without executing page code', () => {
    let contents = [
      { id: 1, isDestroyed: () => false, getOSProcessId: () => 10, getType: () => 'browserView', mainFrame: { framesInSubtree: [{ osProcessId: 10 }, { osProcessId: 11 }, { get osProcessId() { throw new Error('detached') } }] } },
      { isDestroyed: () => true },
      { id: 3, isDestroyed: () => false, getOSProcessId: () => 0, getType: () => 'browserView', get mainFrame() { throw new Error('gone') } },
    ] as unknown as WebContents[]
    expect(memoryOwners(contents)).toEqual([
      { webContentsId: 1, type: 'browserView', processIds: [10, 11] },
      { webContentsId: 3, type: 'browserView', processIds: [] },
    ])
  })
})
