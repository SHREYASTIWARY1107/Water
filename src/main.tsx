import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installAudioUnlock } from './reminders/sound'

installAudioUnlock()

// After a redeploy, an open tab may request a lazy chunk that no longer exists.
// Reload once to pick up the new build (guarded so it can't loop).
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'hydrate:chunk-reload'
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 30_000) return // already tried; let the ErrorBoundary show a Reload button
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  event.preventDefault()
  window.location.reload()
})

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn('[hydrate] service worker registration failed', err)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
