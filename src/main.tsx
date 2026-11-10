import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AccountProvider } from './components/Account'

// Draft only: ?d=grid|focus|keys shows one of the three design directions.
const direction = new URLSearchParams(location.search).get('d') ?? ''
const stylesheets: Record<string, () => Promise<unknown>> = {
  grid: () => import('./directions/grid.css'),
  focus: () => import('./directions/focus.css'),
  keys: () => import('./directions/keys.css'),
}
void (stylesheets[direction] ?? (() => import('./styles.css')))().then(() => {
  document.documentElement.dataset.direction = direction || 'current'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AccountProvider><App /></AccountProvider>
    </StrictMode>,
  )
})
