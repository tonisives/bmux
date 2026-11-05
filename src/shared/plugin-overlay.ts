export type PluginOverlayControl = { id: string; label: string; kind: 'button' | 'toggle' | 'choice' | 'text'; value?: string | boolean; choices?: string[]; disabled?: boolean; setting?: string }
export type PluginOverlayError = { title: string; message: string; diagnostic?: string; controls?: string[] }
export type PluginOverlayContent = { error?: PluginOverlayError; title: string; subtitle: string; status: string; nodes: { title: string; lines: string[]; tone: 'cyan' | 'green' | 'neutral' }[]; metrics: string; details: { title: string; text: string }[]; controls: PluginOverlayControl[]; copies?: { id: string; label: string; text?: string }[] }
export type PluginOverlayBounds = { x: number; y: number; width: number; height: number; collapsed?: boolean; compact?: boolean }
export type PluginOverlayState = { runId: string; paneId: string; content: PluginOverlayContent; bounds: PluginOverlayBounds; ended: boolean; error?: string }
export type PluginOverlayInput = { id: string; value?: string | boolean }
let text = (value: unknown, maximum: number) => { if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid overlay text'); return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') }
let array = (value: unknown, maximum: number) => { if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid overlay list'); return value }
export let parsePluginOverlay = (value: Record<string, unknown>): PluginOverlayContent => {
  let { copies: rawCopies, ...layout } = value
  if (JSON.stringify(value).length > 900000) throw new Error('Overlay payload exceeds 900 KB')
  if (JSON.stringify(layout).length > 32768) throw new Error('Overlay exceeds 32 KB')
  let controls = array(value.controls ?? [], 16).map((control): PluginOverlayControl => {
    if (!control || !['button','toggle','choice','text'].includes(control.kind) || !/^[a-zA-Z0-9._-]{1,64}$/.test(control.id)) throw new Error('Invalid overlay control')
    let choices = control.kind === 'choice' ? array(control.choices, 16).map(choice => text(choice, 80)) : undefined
    if (control.setting !== undefined && (control.kind !== 'button' || typeof control.setting !== 'string' || !/^[a-zA-Z0-9._-]{1,64}$/.test(control.setting))) throw new Error('Invalid overlay settings link')
    let result = { ...(control.setting ? { setting: control.setting as string } : {}), id: control.id, label: text(control.label, 80), kind: control.kind, value: control.value, disabled: control.disabled === true, choices }
    if (control.kind !== 'button') validatePluginOverlayInput({ ...result, disabled: false }, control.value)
    return result
  })
  if (new Set(controls.map(control => control.id)).size !== controls.length) throw new Error('Duplicate overlay control')
  for (let control of controls) if (control.setting && !controls.some(target => target.id === control.setting && target.kind !== 'button')) throw new Error('Unknown overlay setting')
  let copies = array(rawCopies ?? [], 2).map(copy => {
    if (!copy || !/^[a-zA-Z0-9._-]{1,64}$/.test(copy.id)) throw new Error('Invalid overlay copy')
    return { id: copy.id, label: text(copy.label, 80), text: text(copy.text, 300000) }
  })
  if (new Set(copies.map(copy => copy.id)).size !== copies.length) throw new Error('Duplicate overlay copy')
  let error = value.error === undefined ? undefined : value.error as Record<string, unknown>
  let failure = error ? { title: text(error.title, 100), message: text(error.message, 1000), ...(error.diagnostic === undefined ? {} : { diagnostic: text(error.diagnostic, 2000) }), controls: array(error.controls ?? [], 4).map(id => { let name = text(id, 64); if (!controls.some(control => control.id === name && control.kind === 'button')) throw new Error('Unknown overlay recovery control'); return name }) } : undefined
  return { ...(failure ? { error: failure } : {}), copies, title: text(value.title, 100), subtitle: text(value.subtitle ?? '', 180), status: text(value.status ?? '', 180), metrics: text(value.metrics ?? '', 300), controls,
    nodes: array(value.nodes ?? [], 8).map(node => { if (!node || !['cyan','green','neutral'].includes(node.tone)) throw new Error('Invalid overlay node'); return { title: text(node.title, 80), lines: array(node.lines, 12).map(line => text(line, 800)), tone: node.tone } }),
    details: array(value.details ?? [], 8).map(detail => ({ title: text(detail.title, 80), text: text(detail.text, 12000) })),
  }
}
export let validatePluginOverlayInput = (control: PluginOverlayControl, value: unknown) => {
  if (control.disabled || (control.kind === 'toggle' ? typeof value !== 'boolean' : control.kind === 'choice' ? typeof value !== 'string' || !control.choices?.includes(value) : control.kind === 'text' ? typeof value !== 'string' || value.length > 2000 : value !== undefined)) throw new Error('Invalid overlay input')
}
export let pluginOverlayHeight = (bounds: Pick<PluginOverlayBounds, 'height' | 'collapsed' | 'compact'>) => bounds.collapsed ? 32 : bounds.compact ? Math.min(64, bounds.height) : bounds.height
export let fitPluginOverlay = (bounds: PluginOverlayBounds | undefined, area: {x:number;y:number;width:number;height:number}): PluginOverlayBounds => {
  let width = Math.min(Math.max(280, bounds?.width ?? 384), Math.max(1, area.width)), height = Math.min(Math.max(240, bounds?.height ?? 600), Math.max(1, area.height))
  let collapsed = bounds?.collapsed === true
  return { x: Math.round(Math.max(area.x, Math.min(bounds?.x ?? area.x + area.width - width - 12, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds?.y ?? area.y + 12, area.y + area.height - pluginOverlayHeight({ height, collapsed, compact: bounds?.compact })))), width: Math.round(width), height: Math.round(height), collapsed, ...(bounds?.compact ? { compact: true } : {}) }
}

export let conciseConfidence = (line: string) => /confidence/i.test(line) && /\d+(?:\.\d+)?%/.test(line) ? 'Confidence: ' + line.match(/\d+(?:\.\d+)?%/)![0] : line.replace(/\s*· very confident match/i, '')
export let pluginOverlaySummary = (content: PluginOverlayContent) => {
  let lines = content.nodes.filter(node => /\bAI\b|decision|caption match/i.test(node.title)).flatMap(node => node.lines.map(conciseConfidence))
  let decisions = lines.filter(line => /\d+(?:\.\d+)?%/.test(line)).map(line => line.replace(/^Profile match:/i, 'Match:').replace(/^Confidence:/i, 'Conf:')).join(' · ')
  let action = /^(paused|waiting|browsing stopped|session complete)/i.test(content.status) ? content.status : lines.findLast(line => /^(watching|skipping|moving|reading|checking|applying|waiting|watch to|watch for)/i.test(line)) || content.status
  return { decisions, action }
}
