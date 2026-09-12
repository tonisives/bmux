import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { PasswordPopup } from './PasswordPopup'
import './global.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode>{location.hash === '#passwords' ? <PasswordPopup /> : <App />}</React.StrictMode>)
