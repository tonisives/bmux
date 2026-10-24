import type { RemoteNetwork } from '../../src/shared/remote-management'

export let qualityNetwork = (state: { type: string; details?: { isConnectionExpensive?: boolean } | null }): RemoteNetwork => {
  if (state.type === 'cellular') return 'cellular'
  if (state.type === 'wifi' || state.type === 'ethernet') return state.details?.isConnectionExpensive ? 'unknown' : 'wifi'
  return 'unknown'
}
