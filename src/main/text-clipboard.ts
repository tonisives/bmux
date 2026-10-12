type Clipboard = { readText: () => Promise<string>; writeText: (text: string) => Promise<void> }

export let createTextClipboard = (clipboard: Clipboard) => {
  let pending = Promise.resolve('')
  return (text?: string) => {
    let work = pending.then(async () => { if (text === undefined) return clipboard.readText(); await clipboard.writeText(text); return '' })
    pending = work.catch(() => '')
    return work
  }
}
