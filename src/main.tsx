import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AccountProvider } from './components/Account'
// Self-hosted, so the fonts also load where Google Fonts is blocked.
import '@fontsource/klee-one/400.css'
import '@fontsource/klee-one/600.css'
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css'
import 'lxgw-wenkai-webfont/lxgwwenkai-bold.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccountProvider><App /></AccountProvider>
  </StrictMode>,
)
