import { useState } from 'react'
import { SessionTree } from './SessionTree'
import type { Host } from './client'
import styles from './style.module.css'

let pages = [
  { id: 'quotes', title: 'Quotes to collect', url: 'https://demo.bmux.cc/quotes', heading: 'A small reading list', description: 'A static page for a browser agent to collect and compare.', rows: [['The Art of Noticing', 'Rob Walker', 'Reading'], ['A Field Guide to Getting Lost', 'Rebecca Solnit', 'Saved'], ['Ways of Seeing', 'John Berger', 'Collected']] },
  { id: 'research', title: 'Research notes', url: 'https://demo.bmux.cc/research', heading: 'Research notes', description: 'The browser stays on its page while you observe another session.', rows: [['Compare sources', 'Three articles reviewed', 'Complete'], ['Collect references', 'Seven links saved', 'Complete'], ['Draft a reading list', 'Waiting for review', 'Ready']] },
  { id: 'catalog', title: 'Product catalog', url: 'https://demo.bmux.cc/catalog', heading: 'Workshop supplies', description: 'Sample catalog data for a collection task.', rows: [['Grid notebook', 'Stationery', '$8.50'], ['Brass bookmark', 'Reading', '$12.00'], ['Desk tray', 'Organization', '$24.00']] },
  { id: 'results', title: 'Collection results', url: 'https://demo.bmux.cc/results', heading: 'Collection results', description: 'Collected rows remain available when you return to a browser.', rows: [['Notebook', 'In stock', 'Saved'], ['Bookmark', 'In stock', 'Saved'], ['Desk tray', 'In stock', 'Saved']] },
]
export let demoHosts: Host[] = ['Research node', 'Collection node'].map((name, index) => ({
  id: `demo-node-${index + 1}`, generation: 'static-demo', service: 'Demo', permission: 'watch', owner: false,
  key: { kty: 'OKP', crv: 'Ed25519', x: 'a'.repeat(43) }, machine: { name, platform: 'linux', arch: 'x64', version: 'Demo' },
  sessions: pages.slice(index * 2, index * 2 + 2).map(page => ({ id: page.id, name: page.title, panes: [{ id: page.id, title: page.title }] })),
}))

export let DemoWorkspace = ({ buy, close }: { buy: () => void; close?: () => void }) => {
  let [selected, setSelected] = useState('demo-node-1:quotes')
  let page = pages.find(page => selected.endsWith(':' + page.id)) ?? pages[0]
  return <div className={`${styles.workspace} ${styles.workspaceActive}`}>
    <aside className={styles.library} aria-label="Demo sessions">
      <div className={styles.sectionHeading}><h1>Demo</h1><span>2 nodes · 4 browsers</span></div>
      <div className={styles.libraryActions}>{close && <button onClick={close}>Your sessions</button>}</div>
      <div className={styles.sessions}><SessionTree hosts={demoHosts} selected={selected} pane={page.id} select={(host, session) => setSelected(`${host.id}:${session.id}`)} details={host => setSelected(`${host.id}:${host.sessions[0].id}`)} color={id => id.endsWith('1') ? '#34b3a0' : '#e5a450'} /></div>
      <div className={styles.demoOffer}><p>Connect your own browsers.</p><button className={styles.primaryButton} onClick={buy}>Get relay · $10/month</button></div>
    </aside>
    <section className={styles.viewer} aria-label="Demo browser">
      <div className={styles.viewerToolbar}><span className={styles.demoAddress}>{page.url}</span><span className={styles.status}>Watching demo</span></div>
      <div className={styles.demoPage} role="document" aria-label={page.title + ' demo browser'}><article><small>BMUX DEMO / {page.title}</small><h2>{page.heading}</h2><p>{page.description}</p><table><tbody>{page.rows.map((row, index) => <tr key={index}>{row.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></article></div>
      <p className={styles.demoCaption}>Static demo · Select any browser to observe its page.</p>
    </section>
  </div>
}
