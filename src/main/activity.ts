import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ActivityEpisode, ActivityEvent, ActivityTarget } from '../shared/activity'

type Stored = { episodes: ActivityEpisode[]; events: ActivityEvent[]; sequence: number }
export let createActivity = (file: string, now = Date.now, idleMs = 30000) => {
  let stored: Stored = { episodes: [], events: [], sequence: 0 }
  try { stored = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  let listeners = new Set<() => void>()
  let persist = () => { stored.events = stored.events.filter(event => now()-event.occurredAt < 7*86400000).slice(-20000); stored.episodes = stored.episodes.filter(episode => episode.endedAt === undefined || now()-episode.endedAt < 86400000 || stored.events.some(event=>event.episodeId===episode.id)); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(stored), { mode: 0o600, flush: true }); fs.renameSync(file + '.tmp', file); for (let listener of listeners) listener() }
  let emit = (episode: ActivityEpisode, target: ActivityTarget, type: ActivityEvent['type'], extra: Partial<ActivityEvent> = {}) => {
    stored.events.push({ version: 1, id: randomUUID(), episodeId: episode.id, sequence: ++stored.sequence, type, occurredAt: now(), target, ...extra })
  }
  let end = (episode: ActivityEpisode, reason: string) => {
    if (episode.endedAt !== undefined) return
    episode.endedAt = now(); episode.reason = reason
    emit(episode, { sessionId: episode.sessionId, agentId: episode.agentId, paneId: episode.panes[0], profileId: episode.profileId ?? '' }, 'agent.session.end', { reason })
  }
  for (let episode of stored.episodes) if (episode.endedAt === undefined) { episode.pending = 0; end(episode, 'host-restarted') }
  persist()
  let begin = (target: ActivityTarget, method: string) => {
    let episode = stored.episodes.find(item => item.endedAt === undefined && item.sessionId === target.sessionId && item.agentId === target.agentId)
    if (!episode) {
      episode = { id: randomUUID(), profileId: target.profileId, sessionId: target.sessionId, agentId: target.agentId, panes: [], startedAt: now(), lastActivityAt: now(), pending: 0 }
      stored.episodes.push(episode); emit(episode, target, 'agent.session.start')
    }
    if (!episode.panes.includes(target.paneId)) episode.panes.push(target.paneId)
    episode.pending++; episode.lastActivityAt = now(); persist()
    let started = now(), finished = false, current = episode
    return (outcome: ActivityEvent['outcome'] = 'success') => {
      if (finished) return
      finished = true; current.pending = Math.max(0, current.pending - 1); current.lastActivityAt = now()
      emit(current, target, 'agent.action', { method, outcome, durationMs: now() - started }); persist()
    }
  }
  let tick = () => { let changed = false; for (let episode of stored.episodes) if (episode.endedAt === undefined && !episode.pending && now() - episode.lastActivityAt >= idleMs) { end(episode, 'idle'); changed = true }; if (changed) persist() }
  return {
    begin, tick, episodes: () => structuredClone(stored.episodes), events: () => structuredClone(stored.events),
    acknowledge: (id: string) => { if(!stored.events.some(event=>event.id===id))return; stored.events = stored.events.filter(event => event.id !== id); stored.episodes = stored.episodes.filter(item => item.endedAt === undefined || stored.events.some(event => event.episodeId === item.id) || now() - item.endedAt < 86400000); persist() },
    close: () => { for (let episode of stored.episodes) end(episode, 'shutdown'); persist() },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
}
