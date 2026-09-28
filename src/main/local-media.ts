import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

let mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg',
}

export let localMediaPath = (url: string) => {
  try {
    let parsed = new URL(url)
    if (parsed.protocol !== 'file:') return
    let file = fileURLToPath(parsed)
    return mediaTypes[path.extname(file).toLowerCase()] ? file : undefined
  } catch { return }
}

export let localMediaResponse = async (request: Request): Promise<Response | undefined> => {
  let file = localMediaPath(request.url)
  if (!file || !['GET', 'HEAD'].includes(request.method)) return
  let info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return new Response(null, { status: 404 })
  let size = info.size
  let range = request.headers.get('range')
  let start = 0, end = size - 1, status = 200
  if (range) {
    let match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    if (match[1]) {
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end
    } else start = Math.max(0, size - Number(match[2]))
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    status = 206
  }
  let headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Content-Type': mediaTypes[path.extname(file).toLowerCase()],
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  let stream = createReadStream(file, { start, end })
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
}
