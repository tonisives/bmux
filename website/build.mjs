import { build } from 'vite'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let root = fileURLToPath(new URL('.', import.meta.url))
let configFile = `${root}vite.config.ts`
await build({ configFile })
await build({ configFile, publicDir: false, build: { ssr: `${root}src/render.tsx`, outDir: `${root}dist/render`, emptyOutDir: true } })
let { render } = await import(`${root}dist/render/render.js`)
let template = await readFile(`${root}dist/client/index.html`, 'utf8')
await writeFile(`${root}dist/client/index.html`, template.replace('<!--app-html-->', render()))
await rm(`${root}dist/render`, { recursive: true, force: true })
console.log('Built pre-rendered bmux website in website/dist/client.')
