type Recovery = { timer?: ReturnType<typeof setTimeout>; running?: Promise<void>; attempt: number }

// One probe per connection, with a bounded backoff after each recovery request.
export let createProxyRecovery = (check: (profileId: string) => Promise<boolean>) => {
  let pending = new Map<string, Recovery>()
  let delays = [2000, 5000, 10000]
  let schedule = (profileId: string, recovery: Recovery) => {
    if (pending.get(profileId) !== recovery || recovery.attempt >= delays.length) return
    recovery.timer = setTimeout(() => { recovery.timer = undefined; void probe(profileId, recovery) }, delays[recovery.attempt++])
    recovery.timer.unref?.()
  }
  let probe = (profileId: string, recovery: Recovery): Promise<void> => {
    if (recovery.running) return recovery.running
    recovery.running = (async () => {
      let recovered = await check(profileId).catch(() => false)
      if (pending.get(profileId) !== recovery) return
      recovery.running = undefined
      if (recovered) pending.delete(profileId)
      else schedule(profileId, recovery)
    })()
    return recovery.running
  }
  let cancel = (profileId: string) => { clearTimeout(pending.get(profileId)?.timer); pending.delete(profileId) }
  return {
    schedule: (profileId: string) => {
      if (pending.has(profileId)) return
      let recovery: Recovery = { attempt: 0 }
      pending.set(profileId, recovery)
      schedule(profileId, recovery)
    },
    retry: (profileId: string) => {
      let recovery = pending.get(profileId) ?? { attempt: 0 }
      if (recovery.running) return recovery.running
      clearTimeout(recovery.timer)
      recovery.attempt = 0
      pending.set(profileId, recovery)
      return probe(profileId, recovery)
    },
    cancel,
    close: () => { for (let profileId of pending.keys()) cancel(profileId) },
  }
}
