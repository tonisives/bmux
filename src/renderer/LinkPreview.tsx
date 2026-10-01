import { useEffect, useState } from 'react'
import type { Bridge } from '../shared/types'
import css from './LinkPreview.module.css'

export let LinkPreview = ({ tooltip = false }: { tooltip?: boolean }) => {
  let [url, setUrl] = useState('')
  useEffect(() => bridge.linkPreview(setUrl), [])
  return <div className={css.preview} data-tooltip={tooltip || undefined} role={tooltip ? 'tooltip' : undefined} title={tooltip ? undefined : url}>{url}</div>
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
