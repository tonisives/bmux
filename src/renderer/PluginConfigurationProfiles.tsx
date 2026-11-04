import { useId, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PluginProfileOperation, PluginSettingsProfiles } from '../shared/plugins'
import css from './App.module.css'

export let PluginConfigurationProfiles = ({ profiles, busy, change, editingProfile, editProfile }: { profiles: PluginSettingsProfiles; busy: boolean; editingProfile: boolean; editProfile: () => void; change: (operation: PluginProfileOperation) => Promise<void> }) => {
  let [name, setName] = useState(''), [template, setTemplate] = useState(''), [editing, setEditing] = useState<'create' | 'rename'>()
  let selectorId = useId()
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
    <div className={css.settingsRow}><label htmlFor={selectorId}>Browsing profile</label><div className={css.pluginProfileControls}><select id={selectorId} value={profiles.active} onChange={select} disabled={busy}>{profiles.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      {!editingProfile && <button type="button" aria-label="Edit browsing profile" onClick={editProfile} disabled={busy}>Edit</button>}
    </div></div>
    {editingProfile && <><p>Saved within this BMUX profile. Includes persona, interests and browsing settings.</p>
    <div className={css.row}><button type="button" onClick={create} disabled={busy || profiles.items.length >= 12}>New profile</button><button type="button" onClick={rename} disabled={busy}>Rename</button><button type="button" onClick={remove} disabled={busy || profiles.items.length === 1}>Delete</button></div>
    {editing && <div>
      {editing === 'create' && <ProfileTemplate templates={profiles.templates} value={template} onChange={chooseTemplate} disabled={busy} />}
      <label className={css.settingsRow}><span>Profile name</span><input aria-label="Browsing profile name" value={name} maxLength={60} onChange={changeName} disabled={busy} /></label>
      <div className={css.row}><button type="button" onClick={save} disabled={busy || !name.trim()}>{editing === 'create' ? 'Create profile' : 'Save name'}</button><button type="button" disabled={busy} onClick={cancel}>Cancel</button></div>
    </div>}</>}
  </section>
}


let ProfileTemplate = ({ templates, value, onChange, disabled }: { templates: PluginSettingsProfiles['templates']; value: string; onChange: (event: ChangeEvent<HTMLSelectElement>) => void; disabled: boolean }) => <label className={css.settingsRow}><span>Start from</span><select aria-label="Profile template" value={value} onChange={onChange} disabled={disabled}><option value="">Copy current settings</option>{templates?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
