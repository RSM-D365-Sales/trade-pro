import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
// Poppins SemiBold for headings and the wordmark (brand guide), bundled locally — no font CDN.
import '@fontsource/poppins/latin-600.css'
import './index.css'

/**
 * Vite hands us BASE_URL with a trailing slash ('/trade-pro/'). React Router
 * matches a trailing-slash basename against '/trade-pro/' but NOT against
 * '/trade-pro' — so the shell renders and the routed area comes up blank.
 * Stripping the slash makes both forms resolve.
 */
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
