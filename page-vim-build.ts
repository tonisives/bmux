import path from 'node:path'
import { build } from 'esbuild'
import type { Plugin } from 'vite'

// Bundle a DOM-only editor for Chromium's isolated world, without a preload API.
export let pageVimPlugin = (): Plugin => ({
  name: 'bmux-page-vim',
  resolveId: id => id === 'virtual:page-vim' ? '\0virtual:page-vim' : undefined,
  async load(id) {
    if (id !== '\0virtual:page-vim') return
    let result = await build({ entryPoints: [path.resolve('src/page-vim/index.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome144', minify: true, metafile: true, loader: { '.css': 'text' }, plugins: [{ name: 'inline-css', setup: bundler => { bundler.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?inline$/, '')) })) } }] })
    for (let file of Object.keys(result.metafile!.inputs)) this.addWatchFile(path.resolve(file))
    return `export default ${JSON.stringify(result.outputFiles[0].text)}`
  },
})
