import { renderToString } from 'react-dom/server'
import { App } from './App'

export let render = (pathname = '/') => renderToString(<App pathname={pathname} />)

export { documents } from './docs'
