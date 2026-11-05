import { useCallback, useEffect, useState } from 'react'
import type { Bridge } from '../shared/types'

export type PluginAIUsage = { enabled: boolean; active: boolean; remaining: number; limit: number; used: number }
export let pluginAIProblem = (usage?: PluginAIUsage) => !usage ? 'Checking AI subscription…' : !usage.active ? 'An active BMUX subscription is required for AI browsing.' : !usage.enabled ? 'BMUX AI browsing is unavailable.' : usage.remaining <= 0 ? 'Monthly AI allowance used.' : ''
export let usesIncludedAI = (values: Record<string, unknown>) => values.ai_source === 'included' && values.use_decisions !== false && values.ai !== false && values.train_mode !== true && values.train !== true
export let usePluginAI = (enabled: boolean) => {
  let [usage, setUsage] = useState<PluginAIUsage>(), [error, setError] = useState('')
  let check = useCallback(async () => {
    try {
      let value = await (window as unknown as { bmux: Bridge }).bmux.remoteAccount<PluginAIUsage>('/api/ai/usage')
      setUsage(value); setError('')
      return pluginAIProblem(value)
    } catch (failure) {
      let message = failure instanceof Error ? failure.message : 'Could not check AI subscription.'
      setUsage(undefined); setError(message); return message
    }
  }, [])
  useEffect(() => { if (enabled) void check() }, [enabled, check])
  let refresh = () => { void check() }
  return { usage, error, check, refresh, problem: error || pluginAIProblem(usage) }
}
