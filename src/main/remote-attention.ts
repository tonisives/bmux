import fs from 'node:fs'
import path from 'node:path'

export type AttentionRequest = { pane: string; session: string; episode: string; reason: 'help'; createdAt: number; resolvedAt?: number }
export let createAttentionRequests = (file: string) => {
  let requests: AttentionRequest[] = [], unreadable = false
  try {
    let value = JSON.parse(fs.readFileSync(file,'utf8')) as AttentionRequest[]
    if (!Array.isArray(value) || value.length > 1000 || value.some(item => !item || !['pane','session','episode'].every(key => typeof item[key as keyof AttentionRequest] === 'string') || item.reason !== 'help' || !Number.isFinite(item.createdAt))) throw new Error('Invalid attention ledger')
    requests = value
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') unreadable = true }
  let persist = () => { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(`${file}.tmp`,JSON.stringify(requests),{mode:0o600}); fs.renameSync(`${file}.tmp`,file) }
  let assert = (pane: string) => { if (unreadable) throw new Error('Attention ledger unreadable'); if (requests.some(item => item.pane === pane && !item.resolvedAt)) throw new Error('Automation paused for human help. Resume from the affected pane after resolving it.') }
  let request = (pane: string, session: string, episode: string) => {
    if (unreadable) throw new Error('Attention ledger unreadable')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(episode)) throw new Error('Use a stable episode ID of up to 128 letters, numbers, hyphens or underscores')
    let existing = requests.find(item => item.episode === episode)
    if (existing) { if (existing.pane !== pane || existing.session !== session) throw new Error('Episode belongs to another pane'); return existing }
    assert(pane)
    requests = requests.filter(item => !item.resolvedAt || item.resolvedAt > Date.now() - 30 * 86400000)
    if (requests.length >= 1000) throw new Error('Attention request capacity reached')
    let item: AttentionRequest = { pane, session, episode, reason:'help', createdAt:Date.now() }
    requests.push(item); persist(); return item
  }
  let resolve = (pane: string, episode?: string) => {
    let active = requests.find(item => item.pane === pane && !item.resolvedAt)
    if (active && episode && active.episode !== episode) throw new Error('The help request changed. Refresh before resuming.')
    if (active) { active.resolvedAt = Date.now(); persist() }
  }
  return { request, assert, resolve, active: () => requests.filter(item => !item.resolvedAt) }
}
