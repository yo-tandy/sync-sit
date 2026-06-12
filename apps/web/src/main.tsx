import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initErrorCapture } from '@ejm/shared-ui'
import './i18n'
import './index.css'
import App from './App.tsx'

initErrorCapture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
