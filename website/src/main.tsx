import { createRoot, hydrateRoot } from 'react-dom/client'
import { App } from './App'
import './global.css'

let container = document.getElementById('root')!
if (container.children.length) hydrateRoot(container, <App pathname={window.location.pathname} />)
else createRoot(container).render(<App pathname={window.location.pathname} />)
