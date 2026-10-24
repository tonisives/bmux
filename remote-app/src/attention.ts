import type { Attention, Selection } from './types'
import type { RemoteResumeAcknowledgement } from '../../src/shared/remote-attention'

export let attentionMatches = (item: Attention, selected: Selection) => item.host === selected.host && item.generation === selected.generation && item.session === selected.session && item.pane === selected.pane
export let mergeAttention = (current: Attention[], incoming: Attention[]) => {
  let items = new Map(current.map(item => [item.id, item]))
  for (let item of incoming) if (!items.has(item.id) || item.revision >= items.get(item.id)!.revision) items.set(item.id, item)
  return [...items.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
export let selectedAttention = (selected: Selection | undefined, episode: string | undefined, items: Attention[], target?: Attention) => {
  if (!selected) return
  return mergeAttention(items, target ? [target] : []).find(item => attentionMatches(item, selected) && (!episode || item.episode === episode))
}
export let recordedResume = (value: Attention | undefined, target: Attention, request: string) => {
  let attempt = value?.attempt
  if (!value || value.id !== target.id || !attentionMatches(value, target) || value.episode !== target.episode || !Number.isSafeInteger(value.revision) || value.revision <= target.revision || !attempt || attempt.request !== request || !attempt.id || !Number.isFinite(attempt.acknowledgedAt)) return
  return value
}
export let resumeAcknowledgement = (value: unknown, target: Attention): RemoteResumeAcknowledgement => {
  let item = value as Partial<RemoteResumeAcknowledgement> | undefined
  if (item?.resumed !== true || item.status !== 'verifying' || item.episode !== target.episode || !Number.isSafeInteger(item.revision) || item.revision! <= target.revision || typeof item.attemptId !== 'string' || !item.attemptId || !Number.isFinite(item.acknowledgedAt)) throw new Error('The host did not confirm a verification attempt.')
  return item as RemoteResumeAcknowledgement
}

export let createResumeRequests = (read: (key: string) => Promise<string | null>, write: (key: string, value: string) => Promise<void>, uuid: () => string) => {
  let pending = new Map<string, Promise<string>>()
  return (owner: string, target: Attention) => {
    let key = 'bmux.remote.resume.' + encodeURIComponent(owner) + '.' + target.id + '.' + target.revision
    let existing = pending.get(key)
    if (existing) return existing
    let operation = (async () => {
      let stored = await read(key)
      if (stored && /^[a-f0-9-]{36}$/.test(stored)) return stored
      let request = uuid()
      await write(key, request)
      return request
    })()
    pending.set(key, operation)
    void operation.then(() => pending.delete(key), () => pending.delete(key))
    return operation
  }
}
