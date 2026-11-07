// Plugin pacing owns a website until that run ends. Profiles stay independent.
export let createWebsiteLocks = () => {
  let owners = new Map<string, string>()
  let keyFor = (profileId: string, value: string) => {
    try {
      let url = new URL(value)
      if (/^https?:$/.test(url.protocol)) return JSON.stringify([profileId, url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')])
    } catch { /* Local documents have no website lock. */ }
  }
  let assertAvailable = (profileId: string, urls: string[], owner?: string) => {
    for (let url of urls) {
      let key = keyFor(profileId, url), current = key && owners.get(key)
      if (current && current !== owner) throw new Error('Website is busy with another agent in this profile')
    }
  }
  let claim = (profileId: string, urls: string[], owner: string) => {
    assertAvailable(profileId, urls, owner)
    for (let url of urls) { let key = keyFor(profileId, url); if (key) owners.set(key, owner) }
  }
  let release = (owner: string) => { for (let [key, current] of owners) if (current === owner) owners.delete(key) }
  return { assertAvailable, claim, release }
}
