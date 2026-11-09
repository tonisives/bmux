// Plugin pacing owns a profile until that run ends.
export let createWebsiteLocks = () => {
  let owners = new Map<string, string>()
  let keyFor = (profileId: string, value: string) => {
    try {
      let url = new URL(value)
      if (/^https?:$/.test(url.protocol)) return profileId
    } catch { /* Local documents have no website lock. */ }
  }
  let assertAvailable = (profileId: string, urls: string[], owner?: string) => {
    for (let url of urls) {
      let key = keyFor(profileId, url), current = key && owners.get(key)
      if (current && current !== owner) throw new Error('Profile is busy with another agent')
    }
  }
  let claim = (profileId: string, urls: string[], owner: string) => {
    assertAvailable(profileId, urls, owner)
    for (let url of urls) { let key = keyFor(profileId, url); if (key) owners.set(key, owner) }
  }
  let release = (owner: string) => { for (let [key, current] of owners) if (current === owner) owners.delete(key) }
  let owns = (profileId: string, url: string, owner: string) => { let key = keyFor(profileId, url); return !!key && owners.get(key) === owner }
  return { assertAvailable, claim, release, owns }
}
