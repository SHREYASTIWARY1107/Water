/* Hydrate service worker.
 * - Displays reminder notifications (needed on Android; enables action buttons).
 * - Routes notification clicks/actions back to an open app tab.
 * - `push` handler is the extension point for server-sent Web Push later.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

async function focusOrOpen(message) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const scope = self.registration.scope
  const client = all.find((c) => c.url.startsWith(scope)) || all[0]
  if (client) {
    if (message) client.postMessage(message)
    if ('focus' in client) {
      try {
        await client.focus()
      } catch (_) {
        /* focus may be disallowed for action clicks */
      }
    }
    return
  }
  const url = new URL(scope)
  if (message && message.type === 'log-water') url.searchParams.set('log', String(message.amount))
  await self.clients.openWindow(url.href)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  let message = null
  if (event.action === 'log-250') message = { type: 'log-water', amount: 250 }
  else if (event.action === 'snooze-10') message = { type: 'snooze', minutes: 10 }
  // Snooze/log without stealing focus when a tab is already open.
  if (message) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
        if (all.length) {
          all[0].postMessage(message)
          return
        }
        return focusOrOpen(message)
      }),
    )
    return
  }
  event.waitUntil(focusOrOpen(null))
})

// Future: server-sent Web Push (see README "Web Push roadmap").
self.addEventListener('push', (event) => {
  let data = { title: 'Time to hydrate 💧', body: 'Have a glass of water.' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch (_) {
    /* ignore malformed payloads */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: 'hydrate-reminder',
      renotify: true,
      icon: 'favicon.svg',
      actions: [
        { action: 'log-250', title: 'Log 250 ml' },
        { action: 'snooze-10', title: 'Snooze 10 min' },
      ],
    }),
  )
})
