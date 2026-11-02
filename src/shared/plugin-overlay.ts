export type PluginOverlayControl = { id: string; label: string; kind: 'button' | 'toggle' | 'choice' | 'text'; value?: string | boolean; choices?: string[]; disabled?: boolean }
export type PluginOverlayContent = { title: string; subtitle: string; status: string; nodes: { title: string; lines: string[]; tone: 'cyan' | 'green' | 'neutral' }[]; metrics: string; details: { title: string; text: string }[]; controls: PluginOverlayControl[] }
export type PluginOverlayBounds = { x: number; y: number; width: number; height: number; collapsed?: boolean }
export type PluginOverlayState = { runId: string; paneId: string; content: PluginOverlayContent; bounds: PluginOverlayBounds; ended: boolean; error?: string }
export type PluginOverlayInput = { id: string; value?: string | boolean }
let text = (value: unknown, maximum: number) => { if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid overlay text'); return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') }
let array = (value: unknown, maximum: number) => { if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid overlay list'); return value }
export let parsePluginOverlay = (value: Record<string, unknown>): PluginOverlayContent => {
  if (JSON.stringify(value).length > 32768) throw new Error('Overlay exceeds 32 KB')
  let controls = array(value.controls ?? [], 16).map((control): PluginOverlayControl => {
    if (!control || !['button','toggle','choice','text'].includes(control.kind) || !/^[a-zA-Z0-9._-]{1,64}$/.test(control.id)) throw new Error('Invalid overlay control')
    let choices = control.kind === 'choice' ? array(control.choices, 16).map(choice => text(choice, 80)) : undefined
    let result = { id: control.id, label: text(control.label, 80), kind: control.kind, value: control.value, disabled: control.disabled === true, choices }
    if (control.kind !== 'button') validatePluginOverlayInput({ ...result, disabled: false }, control.value)
    return result
  })
  if (new Set(controls.map(control => control.id)).size !== controls.length) throw new Error('Duplicate overlay control')
  return { title: text(value.title, 100), subtitle: text(value.subtitle ?? '', 180), status: text(value.status ?? '', 180), metrics: text(value.metrics ?? '', 300), controls,
    nodes: array(value.nodes ?? [], 8).map(node => { if (!node || !['cyan','green','neutral'].includes(node.tone)) throw new Error('Invalid overlay node'); return { title: text(node.title, 80), lines: array(node.lines, 12).map(line => text(line, 800)), tone: node.tone } }),
    details: array(value.details ?? [], 8).map(detail => ({ title: text(detail.title, 80), text: text(detail.text, 12000) })),
  }
}
export let validatePluginOverlayInput = (control: PluginOverlayControl, value: unknown) => {
  if (control.disabled || (control.kind === 'toggle' ? typeof value !== 'boolean' : control.kind === 'choice' ? typeof value !== 'string' || !control.choices?.includes(value) : control.kind === 'text' ? typeof value !== 'string' || value.length > 2000 : value !== undefined)) throw new Error('Invalid overlay input')
}
export let fitPluginOverlay = (bounds: PluginOverlayBounds | undefined, area: {x:number;y:number;width:number;height:number}): PluginOverlayBounds => {
  let width = Math.min(Math.max(280, bounds?.width ?? 384), Math.max(1, area.width)), height = Math.min(Math.max(240, bounds?.height ?? 600), Math.max(1, area.height))
  let collapsed = bounds?.collapsed === true
  return { x: Math.round(Math.max(area.x, Math.min(bounds?.x ?? area.x + area.width - width - 12, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(bounds?.y ?? area.y + 12, area.y + area.height - (collapsed ? 48 : height)))), width: Math.round(width), height: Math.round(height), collapsed }
}
