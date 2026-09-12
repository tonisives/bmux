import { expect, test } from 'vitest'
import { documentLink, documents, renderDocument } from '../website/src/docs'

test('documentation routes resolve relative and GitHub links to the same local guide', () => {
  expect(documentLink('README.md#model', 'AGENT.md')).toBe('/docs/readme/#model')
  expect(documentLink('../../../docs/bitwarden-desktop-test.md', 'examples/plugins/experimental.bitwarden/README.md')).toBe('/docs/bitwarden-desktop-test/')
  expect(documentLink('https://github.com/tonisives/bmux/blob/main/PLUGINS.md', 'docs/tart-tests.md')).toBe('/docs/plugins/')
  expect(new Set(documents.map(doc => doc.route)).size).toBe(documents.length)
  expect(documents.some(doc => doc.file === 'AGENTS.md')).toBe(false)
})

test('Markdown keeps code and tables while escaping HTML and unsafe links', () => {
  let { html, headings } = renderDocument('README.md', '# Guide\n\n## Setup\n\n## Setup\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n| Guide |\n| --- |\n| [Plugins](PLUGINS.md) |\n\n```sh\npnpm package\n```')
  expect(headings.map(heading => heading.id)).toEqual(['setup', 'setup-1'])
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('href="javascript:')
  expect(html).toContain('href="/docs/plugins/"')
  expect(html).toContain('<table>')
  expect(html).toContain('pnpm package')
})
