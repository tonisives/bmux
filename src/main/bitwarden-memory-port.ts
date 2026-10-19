type Message = { originator?: string; id?: string; action: string; key?: string; data?: unknown }
type PortEvent<T> = { addListener: (listener: (value: T) => void) => void; removeListener: (listener: (value: T) => void) => void }
type Port = { postMessage: (message: Message) => void; disconnect: () => void; onMessage: PortEvent<Message>; onDisconnect: PortEvent<unknown> }
type Update = { key: string; updateType: string }

// Serialized into Bitwarden's popup. No module globals or persistent storage.
export let bitwardenMemoryPort = ({ connect, initialize, update, id }: {
  connect: () => Port
  initialize: (keys: string[]) => void
  update: (change: Update) => void
  id: () => string
}) => {
  type Request = { message: Message; resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout>; retries: number }
  let pending = new Map<string, Request>()
  let keys = new Set<string>()
  let current: Port | undefined
  let detach: (() => void) | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let unavailable = () => new Error('Bitwarden background connection was interrupted. Try again.')
  let finish = (request: Request, error?: Error, value?: unknown) => {
    clearTimeout(request.timer)
    pending.delete(request.message.id!)
    if (error) request.reject(error)
    else request.resolve(value)
  }
  let schedule = () => {
    if (reconnect) return
    if (attempts >= 3) {
      for (let request of pending.values()) finish(request, unavailable())
      return
    }
    reconnect = setTimeout(() => {
      reconnect = undefined
      attempts++
      open()
    }, 100 * 2 ** attempts)
  }
  let disconnected = (port: Port) => {
    if (current !== port) return
    detach?.()
    current = undefined
    try { port.disconnect() } catch { /* Already disconnected. */ }
    for (let request of pending.values()) {
      clearTimeout(request.timer)
      // Reads are safe to repeat. Never replay a possibly committed write.
      if (!['get', 'has'].includes(request.message.action) || request.retries++ >= 1) finish(request, unavailable())
    }
    schedule()
  }
  let send = (port: Port, request: Request) => {
    request.timer = setTimeout(() => {
      // A worker can disappear without delivering onDisconnect in Electron.
      disconnected(port)
    }, 5000)
    try { port.postMessage(request.message) }
    catch { disconnected(port) }
  }
  let open = () => {
    if (current) return current
    let port: Port
    try { port = connect() } catch { schedule(); return }
    current = port
    let message = (message: Message) => {
      if (current !== port || message.originator !== 'background') return
      if (message.action === 'initialization' && Array.isArray(message.data)) {
        attempts = 0
        let next = new Set(message.data as string[])
        // Invalidate cached keys removed while the connection was down (lock,
        // logout, etc.). The worker only lists keys that are still present.
        for (let key of keys) if (!next.has(key)) update({ key, updateType: 'remove' })
        keys = next
        initialize([...keys])
      } else if (message.action === 'subject_update') {
        let change = message.data as Update
        if (change.updateType === 'remove') keys.delete(change.key)
        else keys.add(change.key)
        update(change)
      } else if (message.id) {
        let request = pending.get(message.id)
        if (!request) return
        try { finish(request, undefined, JSON.parse((message.data as string) ?? 'null')) }
        catch { finish(request, unavailable()) }
      }
    }
    let disconnect = () => disconnected(port)
    port.onMessage.addListener(message)
    port.onDisconnect.addListener(disconnect)
    detach = () => {
      port.onMessage.removeListener(message)
      port.onDisconnect.removeListener(disconnect)
    }
    for (let request of pending.values()) {
      if (current !== port) break
      send(port, request)
    }
    return current
  }
  open()
  return {
    request: (action: string, key: string, data?: unknown) => new Promise<unknown>((resolve, reject) => {
      let request: Request = { message: { id: id(), action, key, data: JSON.stringify(data), originator: 'foreground' }, resolve, reject, retries: 0 }
      // Open before registering: open() resends only requests interrupted earlier.
      let port = open()
      if (!port) { reject(unavailable()); return }
      pending.set(request.message.id!, request)
      send(port, request)
    }),
  }
}

export let serializeBitwardenMemoryPort = (source = bitwardenMemoryPort.toString()) => {
  // tsx preserves function names by injecting calls to esbuild's __name helper.
  // Bind those metadata-only helpers inside the serialized closure too; the
  // extension does not have the patching script's module globals.
  let names = [...new Set([...source.matchAll(/\b(__name\d*)\(/g)].map(match => match[1]))]
  return names.length ? `((${names.join(',')})=>(${source}))(${names.map(() => '(value=>value)').join(',')})` : `(${source})`
}

export let patchBitwardenMemoryPort = (source: string, release: string) => {
  let marker = 'bmux-reconnecting-memory-port-v2'
  if (source.includes(marker)) return source
  let current = release === '2026.10.0'
  let init = 'this._port=chrome.runtime.connect({name:t}),this._backgroundResponses$=' + (current ? 'kV' : 'tA') + '(this._port.onMessage).pipe((0,l.T)(([e])=>e),(0,' + (current ? 'za' : 'aa') + '.p)(e=>"background"===e.originator)),this._backgroundResponses$.pipe((0,' + (current ? 'za' : 'aa') + '.p)(e=>"subject_update"===e.action||"initialization"===e.action)).subscribe(e=>{switch(e.action){case"initialization":this.handleInitialize(e.data);break;case"subject_update":this.handleSubjectUpdate(e.data);break;default:throw new Error(`Unknown action: ${e.action}`)}})'
  let delegate = current
    ? 'delegateToBackground(e,t,i){return sBe(this,void 0,void 0,function*(){const n=cu.A.newGuid(),s=(0,Da._)(this._backgroundResponses$.pipe((0,za.p)(e=>e.id===n),(0,l.T)(e=>{var t;return JSON.parse(null!==(t=e.data)&&void 0!==t?t:null)})));this.sendMessage({id:n,key:t,action:e,data:JSON.stringify(i)});return yield s})}'
    : 'delegateToBackground(e,t,i){return Dye(this,void 0,void 0,function*(){const n=Fh.newGuid(),r=(0,qo._)(this._backgroundResponses$.pipe((0,aa.p)(e=>e.id===n),(0,l.T)(e=>{var t;return JSON.parse(null!==(t=e.data)&&void 0!==t?t:null)})));this.sendMessage({id:n,key:t,action:e,data:JSON.stringify(i)});return yield r})}'
  let replacement = 'delegateToBackground(e,t,i){return this.bmuxMemoryPort.request(e,t,i)}'
  let oldMarker = '/* bmux-reconnecting-memory-port */'
  if (source.includes(oldMarker)) {
    let start = source.indexOf('this.bmuxMemoryPort=')
    let end = source.indexOf(oldMarker, start)
    if (start < 0 || end < start || source.split(replacement).length !== 2) throw new Error('Bitwarden memory port upgrade target was not found')
    source = source.slice(0, start) + init + source.slice(end + oldMarker.length)
    source = source.replace(replacement, delegate)
  }
  if (source.split(init).length !== 2 || source.split(delegate).length !== 2) throw new Error('Bitwarden memory port compatibility target was not found')
  return source.replace(init, `this.bmuxMemoryPort=${serializeBitwardenMemoryPort()}({connect:()=>this._port=chrome.runtime.connect({name:t}),initialize:keys=>this.handleInitialize(keys),update:change=>this.handleSubjectUpdate(change),id:()=>${current ? 'cu.A' : 'Fh'}.newGuid()})/* ${marker} */`)
    .replace(delegate, replacement)
}
