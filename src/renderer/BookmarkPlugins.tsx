import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { BookmarkPluginAttachment, BookmarkPluginContribution, BookmarkPluginValue, PluginInfo } from '../shared/plugins'
import { matchesBookmarkPlugin } from '../shared/bookmark-plugins'
import type { PublicState } from '../shared/types'
import css from './BookmarkPlugins.module.css'

type Props = { state: PublicState; profileId: string; bookmarkId: string; url: string; run: (method: string, args?: Record<string, unknown>) => Promise<unknown> }
export let BookmarkPlugins = ({ state, profileId, bookmarkId, url, run }: Props) => {
  let attachments = state.bookmarkPlugins?.[profileId]?.[bookmarkId] ?? []
  let available = (state.plugins ?? []).filter(plugin => plugin.enabled && plugin.bookmark && matchesBookmarkPlugin(plugin.bookmark.matches, url) && !attachments.some(item => item.id === plugin.id))
  let update = (attachment: BookmarkPluginAttachment, remove = false) => run('bookmark.plugins.update', { profile: profileId, bookmark: bookmarkId, ...attachment, remove })
  let add = (event: ChangeEvent<HTMLSelectElement>) => {
    let id = event.target.value
    event.target.value = ''
    if (id) void update({ id, enabled: true, values: {} })
  }
  return <div className={css.plugins} aria-label="Bookmark plugins">
    {attachments.map(attachment => <BookmarkPluginSettings key={attachment.id} attachment={attachment} plugin={state.plugins?.find(plugin => plugin.id === attachment.id)} update={update} />)}
    <label>Add plugin<select aria-label="Add bookmark plugin" value="" onChange={add}><option value="">{available.length ? 'Choose plugin' : 'No matching enabled plugins'}</option>{available.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label>
  </div>
}
let BookmarkPluginSettings = ({ attachment, plugin, update }: { attachment: BookmarkPluginAttachment; plugin?: PluginInfo; update: (attachment: BookmarkPluginAttachment, remove?: boolean) => Promise<unknown> }) => {
  let [values, setValues] = useState(attachment.values)
  useEffect(() => setValues(attachment.values), [attachment.values])
  let change = (name: string, value: BookmarkPluginValue) => setValues(current => ({ ...current, [name]: value }))
  let save = () => { void update({ ...attachment, values }) }
  let toggle = (event: ChangeEvent<HTMLInputElement>) => { void update({ ...attachment, enabled: event.target.checked, values }) }
  let remove = () => { void update(attachment, true) }
  let unavailable = !plugin?.enabled || !plugin.bookmark
  return <div className={css.plugin}>
    <div className={css.heading}><label><input type="checkbox" checked={attachment.enabled} disabled={unavailable} onChange={toggle} />{plugin?.name ?? attachment.id}</label><button type="button" onClick={remove} aria-label={`Remove ${plugin?.name ?? attachment.id} plugin`}>×</button></div>
    {unavailable ? <span>Plugin unavailable or disabled</span> : <BookmarkPluginControls definition={plugin!.bookmark!} values={values} change={change} save={save} />}
  </div>
}
let BookmarkPluginControls = ({ definition, values, change, save }: { definition: BookmarkPluginContribution; values: Record<string, BookmarkPluginValue>; change: (name: string, value: BookmarkPluginValue) => void; save: () => void }) => <>{definition.controls.map(control => {
  let value = values[control.name] ?? control.default
  let update = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => change(control.name, control.kind === 'boolean' ? (event.target as HTMLInputElement).checked : control.kind === 'number' ? Number(event.target.value) : event.target.value)
  let saveToggle = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { update(event) }
  return <div className={css.control} key={control.name}><label>{control.title}{control.kind === 'choice' ? <select aria-label={control.title} value={String(value)} onChange={saveToggle} onBlur={save}>{control.choices?.map(choice => <option key={choice}>{choice}</option>)}</select> : <input aria-label={control.title} type={control.kind === 'boolean' ? 'checkbox' : control.kind === 'number' ? 'number' : 'text'} checked={control.kind === 'boolean' ? value === true : undefined} value={control.kind === 'boolean' ? undefined : String(value)} min={control.min} max={control.max} step={control.step} onChange={update} onBlur={save} />}</label>{control.kind === 'number' && <input type="range" aria-label={`${control.title} slider`} min={control.min ?? 0} max={Math.max(control.max ?? 100, Number(value))} step={control.step ?? 1} value={Number(value)} onChange={update} onPointerUp={save} onBlur={save} />}</div>
})}</>
