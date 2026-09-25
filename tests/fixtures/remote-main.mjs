import { app } from 'electron'
import { createRemoteCapture } from '../../out/main/remote-capture.js'

app.setAppPath(process.cwd())
globalThis.createTestCapture = createRemoteCapture
await import('../../out/main/index.js')
