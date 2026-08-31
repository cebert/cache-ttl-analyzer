import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from './App.tsx'
import './i18n'
import './index.css'
import { SessionsProvider } from './state/SessionsProvider'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from index.html')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <SessionsProvider>
        <App />
      </SessionsProvider>
    </BrowserRouter>
  </StrictMode>,
)
