import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { MediaDevice } from '../shared/types'
import css from './MediaDeviceTest.module.css'

export let mediaDeviceLabel = (devices: MediaDevice[]) => devices.length === 2 ? 'camera and microphone' : devices[0] === 'audio' ? 'microphone' : 'camera'

export let mediaSystemAccessMessage = (devices: MediaDevice[]) => `Allow ${mediaDeviceLabel(devices)} access for bmux in System Settings → Privacy & Security.`

export let MediaDeviceTest = ({ devices, prepare, buttonClassName, startTesting = false }: { devices: MediaDevice[]; prepare: (device: MediaDevice) => Promise<boolean>; buttonClassName?: string; startTesting?: boolean }) => {
  let [testing, setTesting] = useState(startTesting)
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
  let [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  let [deviceId, setDeviceId] = useState('')
  let video = useRef<HTMLVideoElement>(null)
  let meter = useRef<HTMLMeterElement>(null)
  let label = device === 'audio' ? 'Microphone' : 'Camera'
  let selectInput = (nextDeviceId: string) => {
    if (nextDeviceId === deviceId) return
    setStatus('Starting…')
    setDeviceId(nextDeviceId)
  }
  useLayoutEffect(() => {
    let stopped = false
    let disconnected = false
    let stream: MediaStream | undefined
    let audio: AudioContext | undefined
    let sampling: number | undefined
    let enumeration = 0
    let media = navigator.mediaDevices
    let preview = video.current
    let level = meter.current
    let refreshInputs = () => {
      let request = ++enumeration
      void media?.enumerateDevices().then(devices => {
        if (stopped || request !== enumeration) return
        let kind = device === 'audio' ? 'audioinput' : 'videoinput'
        setInputs(devices.filter(input => input.kind === kind && input.deviceId && input.deviceId !== 'default'))
      }).catch(() => {})
    }
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
        refreshInputs()
        let target = deviceId ? { deviceId: { exact: deviceId } } : true
        let input = await media.getUserMedia({ audio: device === 'audio' && target, video: device === 'video' && target })
        if (stopped) { input.getTracks().forEach(track => track.stop()); return }
        stream = input
        refreshInputs()
        input.getTracks()[0].addEventListener('ended', () => {
          if (stopped) return
          disconnected = true
          stop()
          refreshInputs()
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
          if (stopped || disconnected) return
          let samples = new Float32Array(analyser.fftSize)
          sampling = window.setInterval(() => {
            analyser.getFloatTimeDomainData(samples)
            let power = 0
            for (let sample of samples) power += sample * sample
            if (level) level.value = Math.min(1, Math.sqrt(power / samples.length) * 4)
          }, 50)
        }
        if (!stopped && !disconnected) setStatus(device === 'audio' ? 'Speak to check your level.' : '')
      } catch (error) {
        stop()
        if (stopped || disconnected) return
        let name = error instanceof Error ? error.name : ''
        setStatus(name === 'NotFoundError' || name === 'OverconstrainedError' ? deviceId ? `${label} unavailable.` : `No ${label.toLowerCase()} found.`
          : name === 'NotAllowedError' ? `Allow ${label.toLowerCase()} access in system settings.`
          : `Could not start the ${label.toLowerCase()}.`)
      }
    }
    media?.addEventListener('devicechange', refreshInputs)
    void start()
    return () => {
      stopped = true
      media?.removeEventListener('devicechange', refreshInputs)
      stop()
    }
  }, [device, deviceId, label, prepare])
  return <div className={css.device}>
    <DeviceInput label={label} inputs={inputs} deviceId={deviceId} onSelect={selectInput} />
    {device === 'video' ? <video ref={video} aria-label="Camera preview" autoPlay muted playsInline /> : <meter ref={meter} aria-label="Microphone level" min={0} max={1} />}
    {status && <span>{status}</span>}
  </div>
}

let DeviceInput = ({ label, inputs, deviceId, onSelect }: { label: string; inputs: MediaDeviceInfo[]; deviceId: string; onSelect: (deviceId: string) => void }) => {
  let changeInput = (event: ChangeEvent<HTMLSelectElement>) => onSelect(event.currentTarget.value)
  return <label className={css.input}>
    <strong>{label}</strong>
    <select value={deviceId} onChange={changeInput} disabled={!inputs.length && !deviceId}>
      <option value="">System default</option>
      {deviceId && !inputs.some(input => input.deviceId === deviceId) && <option value={deviceId} disabled>Unavailable device</option>}
      {inputs.map((input, index) => <option key={input.deviceId} value={input.deviceId}>{input.label || `${label} ${index + 1}`}</option>)}
    </select>
  </label>
}
