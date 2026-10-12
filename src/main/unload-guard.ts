type Choice = { result: Promise<boolean>; cancel: () => void }
type Attempt = { blocked: boolean; allow: boolean; choice?: Choice; interrupt?: () => void }

// Electron decides beforeunload synchronously. Cancel the first attempt, ask in
// the browser UI, then repeat the same operation only after an explicit Leave.
export let createUnloadGuard = (confirm: () => Choice, blocked: () => void) => {
  let active: Attempt | undefined
  let cancel = () => { active?.choice?.cancel(); active?.interrupt?.(); active = undefined }
  return {
    cancel,
    handle: (event: { preventDefault: () => void }) => {
      if (!active) return false
      if (active.allow) { active.allow = false; event.preventDefault() }
      else { active.blocked = true; blocked() }
      return true
    },
    run: async <T,>(operation: () => Promise<T>, cancelled: T, interrupt?: () => void): Promise<T> => {
      cancel()
      let attempt: Attempt = { blocked: false, allow: false, interrupt }
      active = attempt
      try {
        let result: T
        try { result = await operation() }
        catch (error) { if (!attempt.blocked) throw error; result = cancelled }
        if (active !== attempt) return cancelled
        if (!attempt.blocked) return result
        attempt.choice = confirm()
        if (!await attempt.choice.result || active !== attempt) return cancelled
        attempt.allow = true
        return await operation()
      } finally { if (active === attempt) active = undefined }
    },
  }
}
