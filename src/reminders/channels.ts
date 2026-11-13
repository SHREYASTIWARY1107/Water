/**
 * Delivery channels. The engine only talks to the `ReminderChannel` interface,
 * so a future Web Push channel (server-sent via PushManager subscription) can be
 * swapped in without touching scheduling or UI code.
 */
export interface ReminderPayload {
  title: string
  body: string
  /** Same tag => the OS replaces rather than stacks notifications (dedupe safety net). */
  tag: string
  silent: boolean
}

export type DeliveryResult = 'notification' | 'in-app' | 'failed'

export interface ReminderChannel {
  readonly name: string
  deliver(p: ReminderPayload): Promise<DeliveryResult>
}

/** 'needs-install': iOS/iPadOS Safari only exposes notifications to Home Screen web apps. */
export type PermissionState = NotificationPermission | 'unsupported' | 'needs-install'

export function isIOS(): boolean {
  const ua = navigator.userAgent
  // iPadOS reports as Mac; detect via touch support.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function notificationPermission(): PermissionState {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('Notification' in window)) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!('Notification' in window)) return notificationPermission()
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

const iconUrl = () => new URL(`${import.meta.env.BASE_URL}favicon.svg`, window.location.origin).href

/** Shows OS notifications via the service worker when possible (required on Android, and enables action buttons). */
export class BrowserNotificationChannel implements ReminderChannel {
  readonly name = 'browser-notification'
  private readonly fallback: (p: ReminderPayload) => void

  constructor(fallback: (p: ReminderPayload) => void) {
    this.fallback = fallback
  }

  async deliver(p: ReminderPayload): Promise<DeliveryResult> {
    if (notificationPermission() !== 'granted') {
      // Permission missing/denied: show in-app so the reminder is never silently lost.
      this.fallback(p)
      return 'in-app'
    }
    const options: NotificationOptions & { renotify?: boolean; actions?: { action: string; title: string }[] } = {
      body: p.body,
      tag: p.tag,
      renotify: true,
      silent: p.silent,
      icon: iconUrl(),
      badge: iconUrl(),
      requireInteraction: false,
      data: { url: window.location.href },
      actions: [
        { action: 'log-250', title: 'Log 250 ml' },
        { action: 'snooze-10', title: 'Snooze 10 min' },
      ],
    }
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
      if (reg) {
        await reg.showNotification(p.title, options)
      } else {
        const { actions: _a, ...rest } = options // actions are only valid for SW notifications
        void _a
        const n = new Notification(p.title, rest)
        n.onclick = () => {
          window.focus()
          n.close()
        }
      }
      // If the user is looking at the app, also show it in-app.
      if (document.visibilityState === 'visible') this.fallback(p)
      return 'notification'
    } catch {
      this.fallback(p)
      return 'failed'
    }
  }
}
