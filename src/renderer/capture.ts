import { captureBridge, recordStream } from './capture-stream'
let canvas = document.querySelector('canvas')!, context = canvas.getContext('2d')!, drawing = false
captureBridge.receive(message => {
  if (message.type !== 'frame' || !message.data || drawing) return
  drawing = true
  void (async () => {
    let image = new Image(); image.src = message.data!; await image.decode()
    if (!canvas.width || canvas.width === 300) { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; await recordStream(canvas.captureStream(10)) }
    context.drawImage(image,0,0,canvas.width,canvas.height)
  })().catch(() => captureBridge.event({type:'error',error:'Frame decode failed'})).finally(() => { drawing = false })
})
captureBridge.event({type:'ready'})
