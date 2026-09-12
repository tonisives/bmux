import { Lexer, Parser, Renderer, type Tokens } from 'marked'

export let documents = Object.entries(import.meta.glob<string>(['../../*.md', '!../../AGENTS.md', '../../docs/*.md', '../../examples/plugins/*/README.md', '../README.md', '../../LICENSE'], { query: '?raw', import: 'default', eager: true })).map(([path, markdown]) => {
  let file = path.startsWith('../../') ? path.slice(6) : `website/${path.slice(3)}`
  return { file, markdown, route: `/docs/${file.replace(/^docs\//, '').replace(/\.md$/, '').replace(/\/README$/, '').toLowerCase()}/`, title: markdown.match(/^# (.+)$/m)?.[1] ?? 'MIT license' }
})
export let documentLink = (href: string, file: string) => {
  let github = 'https://github.com/tonisives/bmux'
  let relative = href.replace(`${github}/blob/main/`, '').replace(`${github}#`, 'README.md#')
  if (relative.startsWith('#')) return relative
  if (/^[a-z][a-z\d+.-]*:/i.test(relative)) return /^(https?:|mailto:)/i.test(relative) ? relative : '#'
  let url = new URL(relative, `https://docs.local/${href.startsWith(github) ? 'README.md' : file}`)
  let path = decodeURIComponent(url.pathname.slice(1))
  let doc = documents.find(candidate => candidate.file === path)
  return doc ? `${doc.route}${url.hash}` : `${github}/blob/main/${path}${url.hash}`
}

export let renderDocument = (file: string, markdown: string) => {
  let headings: { id: string; title: string }[] = []
  let counts = new Map<string, number>()
  let renderer = new Renderer()
  let originalTable = renderer.table.bind(renderer)
  Object.assign(renderer, {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    heading: ({ tokens, depth, text }: Tokens.Heading) => {
      let base = slug(text)
      let count = counts.get(base) ?? 0
      counts.set(base, count + 1)
      let id = count ? `${base}-${count}` : base
      if (depth === 2) headings.push({ id, title: text })
      return `<h${depth} id="${escapeHtml(id)}">${renderer.parser.parseInline(tokens)}</h${depth}>`
    },
    link: ({ href, tokens }: Tokens.Link) => `<a href="${escapeHtml(documentLink(href, file))}">${renderer.parser.parseInline(tokens)}</a>`,
    image: ({ text }: Tokens.Image) => escapeHtml(text),
    table: (token: Tokens.Table) => `<div class="table-scroll" tabindex="0" aria-label="Scrollable table">${originalTable(token)}</div>`,
  })
  let parser = new Parser({ renderer })
  let html = file === 'LICENSE' ? `<h1>MIT license</h1><pre>${escapeHtml(markdown)}</pre>` : parser.parse(Lexer.lex(markdown))
  return { html, headings }
}

let escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
let slug = (text: string) => text.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-')

