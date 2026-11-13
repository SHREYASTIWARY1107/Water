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

/** Subscribe this browser (if permission is granted) and register it with the server. Idempotent. */
export async function ensurePushSubscription(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission !== 'granted') return 'inactive'
  try {
    const reg = await registration()
    if (!reg) return 'error'
    const { data: key, error } = await supabase.rpc('get_vapid_public_key')
    if (error || !key) return 'error'

    let sub = await reg.pushManager.getSubscription()
    const current = sub?.options?.applicationServerKey
    if (sub && current && bytesToB64url(current) !== key) {
      await sub.unsubscribe() // server keys rotated
      sub = null
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(key) })

    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error'
    const res = await supabase.rpc('register_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 512),
    })
    if (res.error) return 'error'
    return 'active'
  } catch (e) {
    console.warn('[hydrate] push subscribe failed', e)
    return 'error'
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
