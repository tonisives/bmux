export let PROFILE_COLORS = ['#89a8c7', '#b891c7', '#c9907b', '#87ad91', '#c4a96a', '#789fb0']

export let profileHash = (value: string) => [...value].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261)
export let profileColor = (id: string) => PROFILE_COLORS[profileHash(id) % PROFILE_COLORS.length]
