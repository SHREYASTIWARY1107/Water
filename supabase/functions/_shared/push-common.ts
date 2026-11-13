// Shared helpers for the push edge functions (Deno).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { generateVapidKeys, sendWebPush, type VapidKeys } from './webpush.ts'

export const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'https://shreyastiwary1107.github.io/Water/'
export const APP_URL = Deno.env.get('APP_URL') ?? SUBJECT

export function admin(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export interface PushConfig {
  cronSecret: string
  vapid: VapidKeys
}

/** Loads secrets from Vault; generates and stores VAPID keys on first use. */
export async function loadConfig(db: SupabaseClient): Promise<PushConfig> {
  const read = async () => {
    const { data, error } = await db.rpc('hydrate_push_config')
    if (error) throw new Error(`config: ${error.message}`)
    return data as { cron_secret: string | null; vapid_public: string | null; vapid_private_jwk: string | null }
  }
  let cfg = await read()
  if (!cfg.vapid_public || !cfg.vapid_private_jwk) {
    const fresh = await generateVapidKeys()
    await db.rpc('hydrate_set_vapid', { p_public: fresh.publicKey, p_private_jwk: JSON.stringify(fresh.privateJwk) })
    cfg = await read() // re-read: another run may have won the race
  }
  if (!cfg.cron_secret || !cfg.vapid_public || !cfg.vapid_private_jwk) throw new Error('push config incomplete')
  return { cronSecret: cfg.cron_secret, vapid: { publicKey: cfg.vapid_public, privateJwk: JSON.parse(cfg.vapid_private_jwk) } }
}

interface SubRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  action_token: string
  failure_count: number
}

export interface Notice {
  title: string
  body: string
  tag?: string
}

/** Send to every device of the given users; prune dead subscriptions. */
export async function pushToUsers(db: SupabaseClient, cfg: PushConfig, notices: Map<string, Notice>) {
  const ids = [...notices.keys()]
  const stats = { devices: 0, sent: 0, failed: 0, removed: 0, errors: [] as string[] }
  if (!ids.length) return stats
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id,user_id,endpoint,p256dh,auth,action_token,failure_count')
    .in('user_id', ids)
  if (error) throw new Error(`subscriptions: ${error.message}`)
  const actionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/push-action`

  await Promise.all(
    (subs as SubRow[]).map(async (s) => {
      stats.devices++
      const n = notices.get(s.user_id)!
      const payload = {
        title: n.title,
        body: n.body,
        tag: n.tag ?? 'hydrate-reminder',
        url: APP_URL,
        sid: s.id,
        token: s.action_token,
        actionUrl,
      }
      try {
        const r = await sendWebPush(s, payload, cfg.vapid, SUBJECT, { ttl: 1800, urgency: 'high', topic: 'hydrate-reminder' })
        if (r.ok) {
          stats.sent++
          await db.from('push_subscriptions').update({ last_success_at: new Date().toISOString(), failure_count: 0 }).eq('id', s.id)
        } else if (r.gone || s.failure_count + 1 >= 10) {
          stats.removed++
          await db.from('push_subscriptions').delete().eq('id', s.id)
        } else {
          stats.failed++
          stats.errors.push(`${r.status} ${new URL(s.endpoint).host} ${r.body ?? ''}`.trim())
          await db.from('push_subscriptions').update({ failure_count: s.failure_count + 1 }).eq('id', s.id)
        }
      } catch (e) {
        stats.failed++
        stats.errors.push(String(e).slice(0, 200))
      }
    }),
  )
  return stats
}
