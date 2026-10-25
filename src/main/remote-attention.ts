import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RemoteAttentionAttempt, RemoteAttentionStatus, RemoteResumeAcknowledgement } from '../shared/remote-attention'

export type AttentionRequest = { pane: string; session: string; episode: string; reason: 'help' | 'challenge' | 'account-warning' | 'rate-limit'; createdAt: number; resolvedAt?: number; revision: number; status: RemoteAttentionStatus; originator?: string; attempts: (RemoteAttentionAttempt & { revision: number })[] }
export let createAttentionRequests = (file: string) => {
  let requests: AttentionRequest[] = [], unreadable = false
  let listeners = new Set<() => void>()
  try {
    let value = JSON.parse(fs.readFileSync(file,'utf8')) as AttentionRequest[]
    if (!Array.isArray(value) || value.length > 1000 || value.some(item => !item || !['pane','session','episode'].every(key => typeof item[key as keyof AttentionRequest] === 'string') || !['help','challenge','account-warning','rate-limit'].includes(item.reason) || !Number.isFinite(item.createdAt) || item.attempts !== undefined && (!Array.isArray(item.attempts) || item.attempts.length > 100))) throw new Error('Invalid attention ledger')
    requests = value.map(item => ({ ...item, revision: item.revision ?? 1, status: item.status ?? (item.resolvedAt ? 'resolved' : 'pending'), attempts: item.attempts ?? [] }))
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable = true }
  let persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    let descriptor = fs.openSync(`${file}.tmp`, 'w', 0o600)
    try { fs.writeFileSync(descriptor, JSON.stringify(requests)); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
    fs.renameSync(`${file}.tmp`, file)
    if (process.platform !== 'win32') {
      let directory = fs.openSync(path.dirname(file), 'r')
      try { fs.fsyncSync(directory) } finally { fs.closeSync(directory) }
    }
  }
  let commit = <T>(operation: () => T) => {
    if (unreadable) throw new Error('Attention ledger unreadable')
    let previous = structuredClone(requests)
    let result: T
    try { result = operation(); persist() }
    catch (error) { requests = previous; unreadable = true; throw error }
    for (let notify of listeners) notify()
    return result
  }
  let expire = (restarting = false) => {
    let expired = requests.filter(item => item.status === 'verifying' && (restarting || (item.attempts.at(-1)?.acknowledgedAt ?? 0) < Date.now() - 300000))
    if (expired.length) commit(() => { for (let item of expired) { let attempt = item.attempts.at(-1)!; attempt.outcome = 'verification-timeout'; attempt.completedAt = Date.now(); item.status = 'pending'; item.revision++ } })
  }
  if (!unreadable) expire(true)
  let assert = (pane: string) => { if (unreadable) throw new Error('Attention ledger unreadable'); if (requests.some(item => item.pane === pane && !item.resolvedAt)) throw new Error('Automation paused for human help. Resume from the affected pane after resolving it.') }
  let request = (pane: string, session: string, episode: string, originator?: string, reason: AttentionRequest['reason'] = 'help') => {
    if (unreadable) throw new Error('Attention ledger unreadable')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(episode)) throw new Error('Use a stable episode ID of up to 128 letters, numbers, hyphens or underscores')
    let existing = requests.find(item => item.episode === episode)
    if (existing) { if (existing.pane !== pane || existing.session !== session || existing.originator !== originator) throw new Error('Episode belongs to another pane or agent'); return structuredClone(existing) }
    assert(pane)
    requests = requests.filter(item => !item.resolvedAt || item.resolvedAt > Date.now() - 30 * 86400000)
    if (requests.length >= 1000) throw new Error('Attention request capacity reached')
    let item: AttentionRequest = { pane, session, episode, reason, createdAt:Date.now(), revision:1, status:'pending', attempts:[], ...(originator ? { originator } : {}) }
    return commit(() => { requests.push(item); return structuredClone(item) })
  }
  let resolve = (pane: string, episode?: string) => {
    let active = requests.find(item => item.pane === pane && !item.resolvedAt)
    if (active && episode && active.episode !== episode) throw new Error('The help request changed. Refresh before resuming.')
    if (active?.originator) throw new Error('The originating task must verify this help request')
    if (active) commit(() => { active.resolvedAt = Date.now(); active.status = 'resolved'; active.revision++ })
  }
  let receipt = (pane: string, episode: string, requestId: string): RemoteResumeAcknowledgement | undefined => {
    if (unreadable) throw new Error('Attention ledger unreadable')
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(requestId)) throw new Error('INVALID_REQUEST')
    let item = requests.find(item => item.pane === pane && item.episode === episode)
    if (!item) throw new Error('ATTENTION_CHANGED')
    let duplicate = item.attempts.find(attempt => attempt.request === requestId)
    if (duplicate) return { resumed:true, status:'verifying', episode, revision:duplicate.revision, attemptId:duplicate.id, acknowledgedAt:duplicate.acknowledgedAt }
    if (requests.some(item => item.attempts.some(attempt => attempt.request === requestId))) throw new Error('INVALID_REQUEST')
  }
  let acknowledge = (pane: string, episode: string, revision: number, requestId: string): RemoteResumeAcknowledgement => {
    let duplicate = receipt(pane,episode,requestId)
    if (duplicate) return duplicate
    let item = requests.find(item => item.pane === pane && item.episode === episode)!
    if (item.revision !== revision || item.status !== 'pending') throw new Error('ATTENTION_CHANGED')
    if (item.attempts.length >= 100) throw new Error('ATTENTION_ATTEMPT_LIMIT')
    return commit(() => {
      let attempt = { id:randomUUID(), request:requestId, acknowledgedAt:Date.now(), revision:++item.revision }
      item.status = 'verifying'; item.attempts.push(attempt)
      return { resumed:true, status:'verifying', episode, revision:attempt.revision, attemptId:attempt.id, acknowledgedAt:attempt.acknowledgedAt }
    })
  }
  let verify = (pane: string, episode: string, attemptId: string, originator: string | undefined, outcome: 'verified' | 'verification-failed', code?: string) => {
    if (unreadable) throw new Error('Attention ledger unreadable')
    let item = requests.find(item => item.pane === pane && item.episode === episode), attempt = item?.attempts.at(-1)
    if (!item || item.originator !== originator || !attempt || attempt.id !== attemptId) throw new Error('ATTENTION_CHANGED')
    if (attempt.outcome === outcome) return structuredClone(item)
    if (item.status !== 'verifying' || attempt.outcome) throw new Error('ATTENTION_CHANGED')
    if (code !== undefined && !/^[A-Z0-9_]{1,64}$/.test(code)) throw new Error('Use a short verification code')
    return commit(() => {
      attempt.outcome = outcome; attempt.completedAt = Date.now(); if (code) attempt.code = code
      item.status = outcome === 'verified' ? 'resolved' : 'pending'; item.revision++
      if (outcome === 'verified') item.resolvedAt = Date.now()
      return structuredClone(item)
    })
  }
  let wait = (episode: string, originator: string, timeout = 300000) => new Promise<RemoteResumeAcknowledgement>((resolve, reject) => {
    let done = false
    let finish = (error?: Error, result?: RemoteResumeAcknowledgement) => { if (done) return; done = true; clearTimeout(timer); listeners.delete(check); if (error) reject(error); else resolve(result!) }
    let check = () => {
      if (unreadable) { finish(new Error('Attention ledger unreadable')); return }
      let item = requests.find(item => item.episode === episode)
      if (!item || item.originator !== originator) { finish(new Error('ATTENTION_CHANGED')); return }
      let attempt = item.attempts.at(-1)
      if (item.status === 'verifying' && attempt) finish(undefined, { resumed:true, status:'verifying', episode, revision:attempt.revision, attemptId:attempt.id, acknowledgedAt:attempt.acknowledgedAt })
      else if (item.resolvedAt) finish(new Error('Attention request already resolved'))
    }
    let timer = setTimeout(() => finish(new Error('Attention wait timed out; task remains paused')), Math.min(Math.max(timeout, 1), 3600000))
    listeners.add(check); check()
  })
  let cancelMissing = (panes: Set<string>) => {
    let missing = requests.filter(item => !item.resolvedAt && !panes.has(item.pane))
    if (missing.length) commit(() => { for (let item of missing) { item.status = 'cancelled'; item.resolvedAt = Date.now(); item.revision++ } })
  }
  return { request, assert, resolve, receipt, acknowledge, verify, wait, expire, cancelMissing, all: () => { expire(); return structuredClone(requests) }, active: () => { expire(); return structuredClone(requests.filter(item => !item.resolvedAt)) } }
}
