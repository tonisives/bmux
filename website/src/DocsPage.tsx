import { useEffect, type MouseEvent } from 'react'
import { documents, renderDocument } from './docs'
import page from './SundayPage.module.css'
import css from './DocsPage.module.css'

export let DocsPage = ({ pathname }: { pathname: string }) => {
  let doc = documents.find(candidate => candidate.route === `${pathname.replace(/\/$/, '')}/`)
  useEffect(() => { document.title = `bmux — ${doc?.title ?? 'Documentation'}` }, [doc?.title])
  return <div className={page.page}>
    <a className={page.skipLink} href="#documentation">Skip to content</a>
    <div className={page.container}>
      <header className={`${page.header} ${css.docsHeader}`}><a className={page.brand} href="/">bmux</a><a className={page.secondaryButton} href="/" onClick={goBack}>Back</a></header>
      {doc ? <DocumentContent file={doc.file} markdown={doc.markdown} /> : <DocsIndex missing={pathname !== '/docs/' && pathname !== '/docs'} />}
      <footer className={page.footer}><a href="/">bmux</a><a href="/docs/">All documentation</a></footer>
    </div>
  </div>
}

let DocumentContent = ({ file, markdown }: { file: string; markdown: string }) => {
  let { html, headings } = renderDocument(file, markdown)
  return <main id="documentation" className={css.layout} onClick={jumpToSection}>
    <aside className={css.contents}><nav aria-label="On this page"><strong>On this page</strong>{headings.map(heading => <a key={heading.id} href={`#${heading.id}`}>{heading.title}</a>)}</nav></aside>
    <div className={css.document}><article dangerouslySetInnerHTML={{ __html: html }} /><a className={css.source} href={`https://github.com/tonisives/bmux/blob/main/${file}`}>Edit on GitHub</a></div>
  </main>
}

let DocsIndex = ({ missing }: { missing: boolean }) => <main id="documentation" className={css.index}>
  <h1>{missing ? 'Page not found' : 'Documentation'}</h1>
  {missing && <p>Choose a guide below</p>}
  <nav aria-label="Documentation">{documents.map(doc => <a key={doc.route} href={doc.route}>{doc.title}</a>)}</nav>
</main>

let goBack = (event: MouseEvent<HTMLAnchorElement>) => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!document.referrer || new URL(document.referrer).origin !== location.origin || history.length < 2) return
  event.preventDefault()
  history.back()
}


let jumpToSection = (event: MouseEvent<HTMLElement>) => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  let href = (event.target as Element).closest('a')?.getAttribute('href')
  if (!href?.startsWith('#')) return
  let target = document.getElementById(decodeURIComponent(href.slice(1)))
  if (!target) return
  event.preventDefault()
  history.replaceState(history.state, '', href)
  target.scrollIntoView()
}
