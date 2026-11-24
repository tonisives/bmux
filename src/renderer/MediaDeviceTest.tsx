import { useEffect, useRef, useState } from 'react'
import type { MediaDevice } from '../shared/types'
import css from './MediaDeviceTest.module.css'

export let mediaDeviceLabel = (devices: MediaDevice[]) => devices.length === 2 ? 'camera and microphone' : devices[0] === 'audio' ? 'microphone' : 'camera'

export let MediaDeviceTest = ({ devices, prepare, buttonClassName }: { devices: MediaDevice[]; prepare: (device: MediaDevice) => Promise<boolean>; buttonClassName?: string }) => {
  let [testing, setTesting] = useState(false)
  let toggleTest = () => setTesting(active => !active)
  return <>
    <button type="button" className={buttonClassName} aria-expanded={testing} onClick={toggleTest}>
      {testing ? 'Stop test' : devices.length === 2 ? 'Test devices' : `Test ${mediaDeviceLabel(devices)}`}
    </button>
    {testing && <div className={css.devices} role="group" aria-label="Device test">
      {devices.map(device => <DevicePreview key={device} device={device} prepare={prepare} />)}
    </div>}
  </>
}

let DevicePreview = ({ device, prepare }: { device: MediaDevice; prepare: (device: MediaDevice) => Promise<boolean> }) => {
  let [status, setStatus] = useState('Starting…')
  let video = useRef<HTMLVideoElement>(null)
  let meter = useRef<HTMLMeterElement>(null)
  let label = device === 'audio' ? 'Microphone' : 'Camera'
  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined
    let audio: AudioContext | undefined
    let sampling: number | undefined
    let preview = video.current
    let level = meter.current
    let stop = () => {
      window.clearInterval(sampling)
      stream?.getTracks().forEach(track => track.stop())
      if (preview) preview.srcObject = null
      if (level) level.value = 0
      if (audio && audio.state !== 'closed') void audio.close()
    }
    let start = async () => {
      try {
        let allowed = await prepare(device)
        if (stopped) return
        if (!allowed) { setStatus(`Allow ${label.toLowerCase()} access in system settings.`); return }
        let input = await navigator.mediaDevices.getUserMedia({ audio: device === 'audio', video: device === 'video' })
        if (stopped) { input.getTracks().forEach(track => track.stop()); return }
        stream = input
        input.getTracks()[0].addEventListener('ended', () => {
          stopped = true
          stop()
          setStatus(`${label} disconnected.`)
        }, { once: true })
        if (preview) {
          preview.srcObject = input
          await preview.play()
        } else {
          audio = new AudioContext()
          let analyser = audio.createAnalyser()
          audio.createMediaStreamSource(input).connect(analyser)
          await audio.resume()
          if (stopped) return
          let samples = new Float32Array(analyser.fftSize)
          sampling = window.setInterval(() => {
            analyser.getFloatTimeDomainData(samples)
            let power = 0
            for (let sample of samples) power += sample * sample
            if (level) level.value = Math.min(1, Math.sqrt(power / samples.length) * 4)
          }, 50)
        }
        if (!stopped) setStatus(device === 'audio' ? 'Speak to check your level.' : '')
      } catch (error) {
        stop()
        if (stopped) return
        let name = error instanceof Error ? error.name : ''
        setStatus(name === 'NotFoundError' ? `No ${label.toLowerCase()} found.`
          : name === 'NotAllowedError' ? `Allow ${label.toLowerCase()} access in system settings.`
          : `Could not start the ${label.toLowerCase()}.`)
      }
    }
    void start()
    return () => { stopped = true; stop() }
  }, [device, label, prepare])
  return <div className={css.device}>
    <strong>{label}</strong>
    {device === 'video' ? <video ref={video} aria-label="Camera preview" autoPlay muted playsInline /> : <meter ref={meter} aria-label="Microphone level" min={0} max={1} />}
    {status && <span>{status}</span>}
  </div>
}
