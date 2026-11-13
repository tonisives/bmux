// Use bounded native typing operations, as the collection plugin does. Each
// host operation already has pacing; one operation per character compounds it.
export async function typeSearchQuery(call, pause, between, selector, value) {
  const focused = () => call('eval', { expression: `document.activeElement === document.querySelector(${JSON.stringify(selector)})` })
  call('context', { refresh: true })
  call('click', { selector })
  call('context', { refresh: true })
  if (!focused()) throw new Error('Could not focus the site search field')
  for (const type of ['keyDown', 'keyUp']) call('cdp', { method: 'Input.dispatchKeyEvent', params: { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: process.platform === 'darwin' ? 4 : 2 } })
  for (const type of ['keyDown', 'keyUp']) call('cdp', { method: 'Input.dispatchKeyEvent', params: { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 } })
  for (let offset = 0; offset < value.length;) {
    call('context', { refresh: true })
    if (!focused()) throw new Error('The site search field lost focus')
    const chunk = value.slice(offset, offset + between(16, 24))
    call('type', { selector, text: chunk })
    offset += chunk.length
    await pause(between(250, 650))
  }
  call('context', { refresh: true })
  const exact = call('eval', { expression: `document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}` })
  if (!exact) throw new Error('The site search query changed before submission')
  await pause(between(1200, 2600))
}
