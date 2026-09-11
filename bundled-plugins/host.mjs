import net from 'node:net'

export let host = (method, args = {}) => new Promise((resolve, reject) => {
  let socket = net.createConnection(process.env.BMUX_PLUGIN_SOCKET), output = ''
  socket.setEncoding('utf8')
  socket.setTimeout(180000, () => socket.destroy(new Error('Plugin request timed out')))
  socket.on('connect', () => socket.write(JSON.stringify({ runId: process.env.BMUX_PLUGIN_RUN_ID, token: process.env.BMUX_PLUGIN_TOKEN, method, args }) + '\n'))
  socket.on('data', chunk => { output += chunk; if (output.length > 1_048_576) socket.destroy(new Error('Plugin response too large')) })
  socket.on('error', () => reject(new Error('Plugin host unavailable')))
  socket.on('end', () => { try { let response = JSON.parse(output); if (!response.ok) throw new Error(response.error); resolve(response.result) } catch (error) { reject(error) } })
})

export let finish = async action => {
  try { await action() }
  catch { await host('progress', { percent: 100, message: 'Action could not complete. Check the original page and plugin setup.' }).catch(() => undefined); process.exitCode = 1 }
}
