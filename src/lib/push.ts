/**
 * Web Push subscription management (client side).
 * The server (edge function `send-reminders`, run every minute by pg_cron) delivers reminders
 * to every subscribed device, so they arrive even when Hydrate is closed — required on iPhone.
 */
import { supabase } from './supabase'

export type PushStatus = 'active' | 'inactive' | 'unsupported' | 'error'

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function registration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ])
}

// Cached so that pushManager.subscribe() can run immediately inside a tap handler:
// Safari/iOS only allows subscribing while the user gesture is still "active".
let cachedKey: string | null = null
let cachedReg: ServiceWorkerRegistration | null = null
let lastError: string | null = null

export function lastPushError(): string | null {
  return lastError
}

/** Warm the VAPID key + service worker registration (call when the app loads). */
export async function prefetchPush(): Promise<void> {
  if (!pushSupported()) return
  try {
    cachedReg = cachedReg ?? (await registration())
    if (!cachedKey) {
      const { data } = await supabase.rpc('get_vapid_public_key')
      cachedKey = data ?? null
    }
  } catch {
    /* retried on demand */
  }
}

/**
 * Subscribe this browser and register it with the server. Idempotent.
 * interactive=true (only from a tap handler) may show the permission prompt via subscribe().
 */
export async function ensurePushSubscription({ interactive = false }: { interactive?: boolean } = {}): Promise<PushStatus> {
  lastError = null
  if (!pushSupported()) return 'unsupported'
  const perm = Notification.permission
  if (perm === 'denied' || (perm === 'default' && !interactive)) return 'inactive'
  try {
    const reg = cachedReg ?? (await registration())
    if (!reg) {
      lastError = 'Service worker not ready — reload the app and try again.'
      return 'error'
    }
    cachedReg = reg
    let key = cachedKey
    // Subscribe FIRST (while the tap is still active), using the cached key when we have one.
    let sub = await reg.pushManager.getSubscription()
    if (!key) {
      const { data, error } = await supabase.rpc('get_vapid_public_key')
      if (error || !data) {
        lastError = error?.message ?? 'Server push key unavailable.'
        return 'error'
      }
      key = cachedKey = data
    }
    const current = sub?.options?.applicationServerKey
    if (sub && current && bytesToB64url(current) !== key) {
      await sub.unsubscribe() // server keys rotated
      sub = null
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) })

    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error'
    lastError = null
    const res = await supabase.rpc('register_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 512),
    })
    if (res.error) {
      lastError = res.error.message
      return 'error'
    }
    return 'active'
  } catch (e) {
    console.warn('[hydrate] push subscribe failed', e)
    lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    return Notification.permission === 'granted' ? 'error' : 'inactive'
  }
}

/** Remove this browser's subscription (on sign-out) so the next account here doesn't get your reminders. */
export async function unregisterPush(): Promise<void> {
  if (!pushSupported()) return
  try {
    const reg = await registration(3000)
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await supabase.rpc('unregister_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe()
  } catch {
    /* best effort */
  }
}

/** Ask the server to send a real push to all of this user's devices. */
export async function sendTestPush(): Promise<{ devices: number; sent: number; failed: number; errors?: string[] }> {
  const { data, error } = await supabase.functions.invoke('push-action', { body: { action: 'test' } })
  if (error) throw error
  return data
}
