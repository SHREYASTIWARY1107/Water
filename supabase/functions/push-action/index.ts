// Called by the service worker / app:
//  - { action: 'log-250' | 'snooze-10', sid, token }  → notification buttons, authorised by the
//    per-subscription action token (works even when no app tab is open, so no session exists)
//  - { action: 'test' } with the user's Authorization: Bearer <jwt> → sends a test push to all their devices
import { admin, CORS, json, loadConfig, pushToUsers, safeEqual, type Notice } from '../_shared/push-common.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const db = admin()
  let body: { action?: string; sid?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  try {
    if (body.action === 'test') {
      const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
      const { data, error } = await db.auth.getUser(jwt)
      if (error || !data.user) return json({ error: 'unauthorized' }, 401)
      const cfg = await loadConfig(db)
      const notices = new Map<string, Notice>([
        [data.user.id, { title: 'Hydrate push test 💧', body: 'Background reminders are working on this device.', tag: 'hydrate-test' }],
      ])
      return json(await pushToUsers(db, cfg, notices))
    }

    if (body.action !== 'log-250' && body.action !== 'snooze-10') return json({ error: 'unknown action' }, 400)
    if (!body.sid || !body.token || !/^[0-9a-f-]{36}$/i.test(body.sid)) return json({ error: 'bad request' }, 400)

    const { data: sub } = await db.from('push_subscriptions').select('user_id, action_token').eq('id', body.sid).maybeSingle()
    if (!sub || !safeEqual(body.token, sub.action_token)) return json({ error: 'unauthorized' }, 401)

    if (body.action === 'log-250') {
      const { data: prof } = await db.from('profiles').select('timezone').eq('id', sub.user_id).maybeSingle()
      const { error } = await db
        .from('hydration_logs')
        .insert({ user_id: sub.user_id, amount_ml: 250, timezone: prof?.timezone ?? 'UTC' })
      if (error) throw new Error(error.message)
      return json({ ok: true, logged: 250 })
    }

    const now = new Date()
    const { error } = await db
      .from('reminder_settings')
      .update({ snooze_until: new Date(now.getTime() + 10 * 60_000).toISOString(), snoozed_at: now.toISOString() })
      .eq('user_id', sub.user_id)
    if (error) throw new Error(error.message)
    return json({ ok: true, snoozedMinutes: 10 })
  } catch (e) {
    console.error('[push-action]', e)
    return json({ error: String(e) }, 500)
  }
})
