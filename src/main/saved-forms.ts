import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PluginContext } from '../shared/plugins'
import { pageOrigin } from '../shared/browser-tools'

type Field = { selector: string; value: string; expectedType: string }
type SavedForm = { id: string; name: string; origin: string; fields: Field[] }
type Options = { directory: string; encrypt: (text: string) => Buffer; decrypt: (data: Buffer) => string; available: () => boolean; browser: (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => Promise<unknown> }
export let captureForm = `(() => {
  let selector = node => {
    if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) return '#' + CSS.escape(node.id);
    let parts = [];
    while (node && node !== document.documentElement) { let parent = node.parentElement; if (!parent) return null; parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(node) + 1) + ')'); node = parent; }
    return 'html > ' + parts.join(' > ');
  };
  return Array.from(document.querySelectorAll('input,textarea')).filter(node =>
    ['text', 'email', 'tel', 'url', 'search', 'textarea'].includes(node.type) && node.value && node.value.length <= 10000 &&
    !/password|secret|token|cc-|card|cvc|cvv|ssn|one[ -]time[ -]code/i.test([node.autocomplete, node.name, node.id, node.getAttribute('aria-label'), ...Array.from(node.labels ?? [], label => label.textContent)].join(' ')) &&
    node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && !node.disabled && !node.readOnly
  ).slice(0, 50).map(node => ({ selector: selector(node), value: node.value, expectedType: node.type }));
})()`
export let createSavedForms = (options: Options) => {
  let location = (context: PluginContext) => {
    if (!context.profileId || !/^profile_[a-zA-Z0-9_-]+$/.test(context.profileId) || !pageOrigin(context.url ?? '')) throw new Error('Open a website in a profile first')
    if (!options.available()) throw new Error('Encrypted storage is unavailable')
    return path.join(options.directory, `${context.profileId}.bin`)
  }
  let read = (file: string): SavedForm[] => {
    if (!fs.existsSync(file)) return []
    try {
      if (fs.statSync(file).size > 5_000_000) throw new Error()
      let value = JSON.parse(options.decrypt(fs.readFileSync(file)))
      if (!Array.isArray(value) || value.length > 100) throw new Error()
      return value
    } catch { throw new Error('Could not open encrypted saved forms') }
  }
  let write = (file: string, forms: SavedForm[]) => {
    let text = JSON.stringify(forms)
    if (text.length > 4_000_000) throw new Error('Saved form storage is full')
    fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 })
    fs.writeFileSync(`${file}.tmp`, options.encrypt(text), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file)
  }
  return async (method: string, args: Record<string, unknown>, context: PluginContext, signal: AbortSignal) => {
    signal.throwIfAborted()
    let file = location(context), origin = pageOrigin(context.url!), forms = read(file)
    if (method === 'forms.list') return forms.filter(form => form.origin === origin).map(({ id, name, fields }) => ({ id, name, fields: fields.length }))
    if (method === 'forms.save') {
      if (typeof args.name !== 'string' || !args.name.trim() || args.name.length > 100) throw new Error('A form name is required (maximum 100 characters)')
      let fields = await options.browser('eval', { expression: captureForm }, context, signal) as Field[]
      await options.browser('eval', { expression: 'true' }, context, signal)
      signal.throwIfAborted()
      if (!Array.isArray(fields) || !fields.length) throw new Error('No filled, visible text fields to save')
      if (fields.some(field => typeof field.selector !== 'string' || typeof field.value !== 'string' || !['text', 'email', 'tel', 'url', 'search', 'textarea'].includes(field.expectedType))) throw new Error('Invalid form fields')
      // Re-read after evaluation so concurrent saves cannot overwrite each other.
      forms = read(file)
      if (forms.length >= 100) throw new Error('A profile can store at most 100 forms')
      let form = { id: randomUUID(), name: args.name.trim(), origin, fields }
      write(file, [...forms, form]); return { id: form.id, fields: fields.length }
    }
    let form = forms.find(form => form.id === args.id && form.origin === origin)
    if (!form) throw new Error('Saved form not found for this site and profile')
    if (method === 'forms.delete') { write(file, forms.filter(item => item.id !== form.id)); return { deleted: true } }
    if (method === 'forms.fill') return options.browser('fill', { origin, fields: form.fields }, context, signal)
    throw new Error('Unknown saved form action')
  }
}
