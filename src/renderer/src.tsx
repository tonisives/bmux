import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PermissionPopup } from './PermissionPopup'
import { LinkPreview } from './LinkPreview'
import { FloatingPane } from './FloatingPane'
import './global.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.hash.startsWith('#float=') ? <FloatingPane /> : location.hash === '#permissions' ? <PermissionPopup /> : location.hash === '#link-preview' ? <LinkPreview /> : <App />}</React.StrictMode>)
