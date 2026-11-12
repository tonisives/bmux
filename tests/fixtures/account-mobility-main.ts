import './remote-layout-main'
import { app } from 'electron'
import { createRuntime } from '../../src/main/runtime'
;(globalThis as any).createMobilityRuntime = (directory: string) => {
  let runtime = createRuntime(directory)
  app.on('before-quit', () => runtime.shutdown())
  return runtime
}
