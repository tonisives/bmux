import { renderToString } from 'react-dom/server'
import { App } from './App'

export let render = () => renderToString(<App />)
