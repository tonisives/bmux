import { host, finish } from '../host.mjs'

await finish(async () => {
  let context = await host('context'), action = process.argv[2]
  if (!/^https?:\/\//.test(context.url ?? '')) { await host('progress', { percent: 100, message: 'Open a website first' }); return }
  if (action === 'save') {
    let name = await host('ui', { kind: 'text', title: 'Name this saved form', required: true })
    let result = await host('forms.save', { name })
    await host('progress', { percent: 100, message: `Saved ${result.fields} fields for this site and profile` }); return
  }
  let forms = await host('forms.list')
  if (!forms.length) { await host('progress', { percent: 100, message: 'No saved forms for this site and profile' }); return }
  let id = await host('ui', { kind: 'pick', title: action === 'delete' ? 'Delete a saved form' : 'Choose a saved form', items: forms.map(form => ({ id: form.id, label: form.name, description: `${form.fields} fields` })) })
  if (action === 'delete' && !await host('ui', { kind: 'confirm', title: 'Delete this saved form?' })) return
  let result = await host(action === 'delete' ? 'forms.delete' : 'forms.fill', { id })
  await host('result', result)
})
