type CaptureBridge = { settings: () => Promise<{ enabled: boolean }>; chunk: (bytes: ArrayBuffer) => Promise<void>; event: (value: unknown) => void; receive: (listener: (message: { type: string; data?: string }) => void) => void }
export let captureBridge = (window as unknown as { bmuxCapture: CaptureBridge }).bmuxCapture
export let recordStream = async (stream: MediaStream) => {
  if (!captureBridge || !(await captureBridge.settings()).enabled || stopping || recorder) return
  let mimeType = 'video/webm;codecs=vp8'
  if (!MediaRecorder.isTypeSupported(mimeType)) throw new Error('WebM recording unavailable')
  recorder = new MediaRecorder(new MediaStream(stream.getVideoTracks()), { mimeType, videoBitsPerSecond: 2500000 })
  recorder.ondataavailable = event => {
    if (!event.data.size) return
    buffered += event.data.size
    if (buffered > 8 * 1024 * 1024) { recorder && recorder.state !== 'inactive' && recorder.stop(); captureBridge.event({ type:'error',error:'Recording writer is too slow' }); return }
    writing = writing.then(async () => { await captureBridge.chunk(await event.data.arrayBuffer()); buffered -= event.data.size }).catch(() => { captureBridge.event({type:'error',error:'Recording write failed'}); recorder && recorder.state !== 'inactive' && recorder.stop() })
  }
  recorder.onstop = () => { void writing.finally(() => captureBridge.event({ type:'stopped' })) }
  recorder.onerror = () => captureBridge.event({ type:'error',error:'Video encoding failed' })
  recorder.start(1000); captureBridge.event({ type:'recording' })
}

// Keep one canvas track across reconnects so a pane remains one continuous clip.
export let captureConnectionGap = (value: boolean) => { gap=value;captureBridge?.event({type:'gap',open:value}) }
export let recordVideoStream = async (stream: MediaStream) => {
  if(!captureBridge || !(await captureBridge.settings()).enabled || stopping)return
  if(!source){source=document.createElement('video');source.muted=true;source.playsInline=true}
  source.srcObject=stream;await source.play();captureConnectionGap(false)
  if(canvas)return
  canvas=document.createElement('canvas');canvas.width=source.videoWidth||1280;canvas.height=source.videoHeight||800
  let context=canvas.getContext('2d')!
  drawing=setInterval(()=>{if(stopping){clearInterval(drawing);source?.pause();return}if(!canvas||!source)return;context.fillStyle='#181818';context.fillRect(0,0,canvas.width,canvas.height);if(!gap&&source.readyState>=2)context.drawImage(source,0,0,canvas.width,canvas.height);else{context.fillStyle='#ffffff';context.font='16px monospace';context.fillText('Reconnecting',24,40)}},100)
  await recordStream(canvas.captureStream(10))
}

let recorder: MediaRecorder | undefined, writing = Promise.resolve(), buffered = 0, stopping = false
let source: HTMLVideoElement | undefined, canvas: HTMLCanvasElement | undefined, drawing: ReturnType<typeof setInterval> | undefined, gap = false
captureBridge?.receive(message => { if (message.type === 'stop') { stopping = true; if (recorder && recorder.state !== 'inactive') recorder.stop(); else captureBridge.event({ type:'stopped' }) } })
