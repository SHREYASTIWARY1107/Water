/* Hydrate service worker.
 * - Shows server-sent Web Push reminders (works with the app closed; required on iPhone).
 * - Shows locally scheduled reminders (needed on Android; enables action buttons).
 * - Handles notification buttons: "Log 250 ml" and "Snooze 10 min".
 */
const ICON = 'icons/icon-192.png'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const windowClients = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true })

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Time to hydrate 💧'
  const options = {
    body: data.body || 'Have a glass of water.',
    tag: data.tag || 'hydrate-reminder',
    renotify: true,
    icon: ICON,
    badge: ICON,
    data: { url: data.url, sid: data.sid, token: data.token, actionUrl: data.actionUrl },
    actions: data.sid
      ? [
          { action: 'log-250', title: 'Log 250 ml' },
          { action: 'snooze-10', title: 'Snooze 10 min' },
        ]
      : [],
  }
  event.waitUntil(
    Promise.all([
      // Every push MUST show a notification (iOS revokes silent push subscriptions).
      self.registration.showNotification(title, options),
      windowClients().then((all) => all.forEach((c) => c.postMessage({ type: 'reminder-pushed', title, body: options.body }))),
    ]),
  )
})

async function focusOrOpen(url) {
  const all = await windowClients()
  const scope = self.registration.scope
  const client = all.find((c) => c.url.startsWith(scope)) || all[0]
  if (client && 'focus' in client) {
    try {
      return await client.focus()
    } catch (_) {
      /* focus may be disallowed */
    }
  }
  return self.clients.openWindow(url || scope)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const action = event.action

  if (action === 'log-250' || action === 'snooze-10') {
    if (data.actionUrl && data.sid && data.token) {
      // Server push: act on the server directly (works with no tab open, no session needed).
      event.waitUntil(
        fetch(data.actionUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, sid: data.sid, token: data.token }),
        })
          .then((r) => {
            if (!r.ok) throw new Error('action failed ' + r.status)
            return windowClients().then((all) => all.forEach((c) => c.postMessage({ type: 'synced', action })))
          })
          .catch(() => focusOrOpen(data.url)),
      )
      return
    }
    // Locally scheduled reminder: let the open app handle it with the user's session.
    const message = action === 'log-250' ? { type: 'log-water', amount: 250 } : { type: 'snooze', minutes: 10 }
    event.waitUntil(
      windowClients().then((all) => {
        if (all.length) {
          all[0].postMessage(message)
          return
        }
        const url = new URL(self.registration.scope)
        if (message.type === 'log-water') url.searchParams.set('log', String(message.amount))
        return self.clients.openWindow(url.href)
      }),
    )
    return
  }

  event.waitUntil(focusOrOpen(data.url))
})
