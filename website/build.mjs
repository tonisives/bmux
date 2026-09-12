import { build } from 'vite'
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

let root = fileURLToPath(new URL('.', import.meta.url))
let configFile = `${root}vite.config.ts`
await build({ configFile })
await build({ configFile, publicDir: false, build: { ssr: `${root}src/render.tsx`, outDir: `${root}dist/render`, emptyOutDir: true } })
let { render } = await import(`${root}dist/render/render.js`)
let template = await readFile(`${root}dist/client/index.html`, 'utf8')
await writeFile(`${root}dist/client/index.html`, template.replace('<!--app-html-->', render()))
for (let [route, title] of [['styles', 'Three simple designs'], ['styles/sunday', 'Sunday'], ['styles/desktop', 'Desktop'], ['styles/peach', 'Peach']]) {
  let directory = `${root}dist/client/${route}`
  await mkdir(directory, { recursive: true })
  let page = template.replace('<!--app-html-->', render(`/${route}/`))
    .replace('<title>bmux — Browser with split panes, sessions and agent control</title>', `<title>bmux — ${title}</title>`)
    .replace('<meta name="theme-color" content="#fbfaf6" />', '<meta name="theme-color" content="#fbfaf6" /><meta name="robots" content="noindex" />')
    .replace('rel="canonical" href="https://bmux.tonis.dev/"', `rel="canonical" href="https://bmux.tonis.dev/${route}/"`)
    .replace('property="og:url" content="https://bmux.tonis.dev/"', `property="og:url" content="https://bmux.tonis.dev/${route}/"`)
    .replaceAll('content="bmux — Browser with split panes, sessions and agent control"', `content="bmux — ${title}"`)
  await writeFile(`${directory}/index.html`, page)
}
await rm(`${root}dist/render`, { recursive: true, force: true })
console.log('Built pre-rendered bmux website in website/dist/client.')
