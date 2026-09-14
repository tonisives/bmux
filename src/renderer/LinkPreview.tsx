import { useEffect, useState } from 'react'
import type { Bridge } from '../shared/types'
import css from './LinkPreview.module.css'

export let LinkPreview = () => {
  let [url, setUrl] = useState('')
  useEffect(() => bridge.linkPreview(setUrl), [])
  return <div className={css.preview} title={url}>{url}</div>
}

let bridge = (window as unknown as { bmux: Bridge }).bmux
