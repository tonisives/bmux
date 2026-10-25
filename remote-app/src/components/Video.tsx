import { useEffect, useRef } from 'react'
import styles from './Video.module.css'

export let Video = ({ stream }: { stream: MediaStream }) => {
  let video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    let element = video.current
    if (element) { element.srcObject = stream; void element.play().catch(() => {}) }
    return () => { if (element) element.srcObject = null }
  }, [stream])
  return <video className={styles.video} ref={video} autoPlay muted playsInline aria-label="Remote browser" />
}
