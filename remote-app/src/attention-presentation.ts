import type { Attention, Host, Selection } from './types'
import { attentionMatches } from './attention'

export let pendingAttention = (items: Attention[]) => items.filter(item => !item.resolved && !item.dismissedAt && (item.status === 'pending' || item.status === 'verifying'))
export let paneAttention = (items: Attention[], selection: Selection) => pendingAttention(items).find(item => attentionMatches(item, selection))

export let attentionDetails = (item: Attention, hosts: Host[]) => {
  let machine = hosts.find(host => host.id === item.host)
  let host = machine?.generation === item.generation ? machine : undefined
  let session = host?.sessions.find(session => session.id === item.session)
  let page = session?.panes.find(pane => pane.id === item.pane)
  let title = item.reason === 'help' ? 'Agent needs your help' : item.reason === 'rate-limit' ? 'Browser is waiting' : 'Browser needs attention'
  let labels = { pending: 'Paused', verifying: 'Checking', resolved: 'Completed', cancelled: 'Cancelled', expired: 'Expired' }
  return {
    title, page: page?.title, context: [machine?.service || 'Your browser', session?.name].filter(Boolean).join(' · '),
    status: labels[item.status], active: !item.resolved && (item.status === 'pending' || item.status === 'verifying'),
  }
}
