import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './App'
import './global.css'

let container = document.getElementById('root')!
if (container.children.length) hydrateRoot(container, <App />)
else createRoot(container).render(<App />)
