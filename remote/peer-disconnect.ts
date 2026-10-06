type PeerIdentity = { id: string; owner: string; role: 'host' | 'viewer' }

export let notifyDisconnected = async <Peer extends PeerIdentity>(peers: Map<string, Peer>, current: Peer, permission: (owner: string, host: Peer) => Promise<unknown>, send: (peer: Peer, message: unknown) => void) => {
  for (let other of peers.values()) {
    if (peers.has(current.id)) return
    if (other.role === current.role) continue
    let access = await permission(current.role === 'viewer' ? current.owner : other.owner, current.role === 'host' ? current : other)
    // Authorization yields to socket upgrades. An old close must not tear down
    // a viewer that has reconnected, or reach a replacement target connection.
    if (peers.has(current.id)) return
    if (peers.get(other.id) !== other) continue
    if (access) send(other, { type: 'disconnected', id: current.id })
  }
}
