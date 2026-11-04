import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PluginProfileOperation, PluginSettingsProfiles } from '../shared/plugins'
import css from './App.module.css'

export let PluginConfigurationProfiles = ({ profiles, busy, change }: { profiles: PluginSettingsProfiles; busy: boolean; change: (operation: PluginProfileOperation) => Promise<void> }) => {
  let [name, setName] = useState(''), [template, setTemplate] = useState(''), [editing, setEditing] = useState<'create' | 'rename'>()
  let active = profiles.items.find(item => item.id === profiles.active)!
  let select = (event: ChangeEvent<HTMLSelectElement>) => void change({ action: 'select', id: event.target.value })
  let chooseTemplate = (event: ChangeEvent<HTMLSelectElement>) => { setTemplate(event.target.value); setName(profiles.templates?.find(item => item.id === event.target.value)?.name ?? '') }
  let changeName = (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)
  let cancel = () => setEditing(undefined)
  let create = () => { setEditing('create'); setName(''); setTemplate('') }
  let rename = () => { setEditing('rename'); setName(active.name) }
  let save = () => void change({ action: editing!, id: active.id, name, ...(editing === 'create' && template ? { template } : {}) })
  let remove = () => void change({ action: 'delete', id: active.id })
  return <section className={css.pluginProfiles} aria-label="Browsing profiles">
    <label className={css.settingsRow}><span>Browsing profile</span><select aria-label="Browsing profile" value={profiles.active} onChange={select} disabled={busy}>{profiles.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <p>Saved within this BMUX profile. Includes persona, interests and browsing settings.</p>
    <div className={css.row}><button type="button" onClick={create} disabled={busy || profiles.items.length >= 12}>New profile</button><button type="button" onClick={rename} disabled={busy}>Rename</button><button type="button" onClick={remove} disabled={busy || profiles.items.length === 1}>Delete</button></div>
    {editing && <div>
      {editing === 'create' && <label className={css.settingsRow}><span>Start from</span><select aria-label="Profile template" value={template} onChange={chooseTemplate} disabled={busy}><option value="">Copy current settings</option>{profiles.templates?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className={css.settingsRow}><span>Profile name</span><input aria-label="Browsing profile name" value={name} maxLength={60} onChange={changeName} disabled={busy} /></label>
      <div className={css.row}><button type="button" onClick={save} disabled={busy || !name.trim()}>{editing === 'create' ? 'Create profile' : 'Save name'}</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></div>
    </div>}
  </section>
}
