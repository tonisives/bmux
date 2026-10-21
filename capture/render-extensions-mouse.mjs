import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
let exec = promisify(execFile)
let ffmpeg = process.env.BMUX_FFMPEG ?? '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
let [source, destination] = process.argv.slice(2)
if (!source || !destination) throw new Error('Usage: node capture/render-extensions-mouse.mjs SOURCE DESTINATION')
source = path.resolve(source); destination = path.resolve(destination)
let capture = JSON.parse(await readFile(path.join(source, 'capture.json'), 'utf8'))
await mkdir(destination, { recursive: true })
await copyFile('/Users/tonis/Movies/video-library/video-template.json', path.join(destination, 'video-template.json'))
let frames = capture.frames
let quote = value => value.replaceAll("'", "'\\''")
let manifest = frames.flatMap((frame, index) => [
  `file '${quote(path.join(source, 'frames', frame.file))}'`,
  'option framerate 1000',
  `duration ${Math.max(.001, (frames[index + 1]?.at ?? capture.duration) - frame.at).toFixed(3)}`,
])
manifest.push(`file '${quote(path.join(source, 'frames', frames.at(-1).file))}'`)
await writeFile(path.join(destination, 'frames.txt'), manifest.join('\n'))
let crop = { ...capture.crop }
if (capture.video) {
  let dimensions = async file => JSON.parse((await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file])).stdout).streams[0]
  let video = await dimensions(path.join(source, capture.video)), frame = await dimensions(path.join(source, 'frames', frames[0].file))
  let ratio = video.width / frame.width
  crop = Object.fromEntries(Object.entries(crop).map(([key, value]) => [key, Math.round(value * ratio / 2) * 2]))
}
let filters = [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`, 'scale=1440:900:force_original_aspect_ratio=decrease', 'pad=1440:900:(ow-iw)/2:(oh-ih)/2:color=0x171b20', 'pad=1920:1080:240:40:color=0x171b20']
for (let [index, chapter] of capture.chapters.entries()) {
  let filename = path.join(destination, `chapter-${index}.txt`)
  await writeFile(filename, chapter.title)
  filters.push(`drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:textfile=${filename}:fontcolor=0xd8dfd2:fontsize=28:x=240:y=987:enable='between(t,${chapter.at.toFixed(3)},${(capture.chapters[index + 1]?.at ?? capture.duration).toFixed(3)})'`)
}
await writeFile(path.join(destination, 'filter.txt'), filters.join(','))
await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...(capture.video ? ['-i', path.join(source, capture.video)] : ['-f', 'concat', '-safe', '0', '-i', path.join(destination, 'frames.txt')]), '-t', String(capture.duration), '-vf', filters.join(','), '-r', '30', '-an', '-c:v', 'libx264', '-threads', '4', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(destination, 'extensions-mouse-demo.mp4')], { timeout: 120000 })
await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2', '-i', path.join(destination, 'extensions-mouse-demo.mp4'), '-frames:v', '1', path.join(destination, 'poster.jpg')])
console.log(path.join(destination, 'extensions-mouse-demo.mp4'))
