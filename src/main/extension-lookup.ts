type NamedExtension = { id: string; name: string }

export let findExtension = <T extends NamedExtension>(extensions: T[], query: string) => {
  let normalized = query.trim().toLowerCase()
  let exact = extensions.find(extension => extension.id === query || extension.name.toLowerCase() === normalized)
  if (exact) return exact
  let prefixes = extensions.filter(extension => extension.name.toLowerCase().startsWith(`${normalized} `))
  return prefixes.length === 1 ? prefixes[0] : undefined
}
