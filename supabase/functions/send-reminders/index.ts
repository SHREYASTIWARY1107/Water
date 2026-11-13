// Invoked every minute by pg_cron (see migration *_push_cron.sql).
// Auth: x-cron-secret header must match the Vault secret `hydrate_cron_secret`.
import { admin, json, loadConfig, pushToUsers, safeEqual, type Notice } from '../_shared/push-common.ts'

const TITLES = [
  'Time for a glass of water 💧',
  'A few sips now keeps the headache away.',
  'Your body is ~60% water — top it up.',
  'Hydration break! Stretch and sip.',
  'Small sips, big difference. Drink up.',
]

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  const db = admin()
  try {
    const cfg = await loadConfig(db)
    if (!safeEqual(req.headers.get('x-cron-secret') ?? '', cfg.cronSecret)) return json({ error: 'unauthorized' }, 401)

    const { data: due, error } = await db.rpc('claim_due_push_reminders')
    if (error) throw new Error(`claim: ${error.message}`)

    const notices = new Map<string, Notice>()
    for (const row of (due ?? []) as { o_user_id: string; o_total_ml: number; o_goal_ml: number }[]) {
      const remaining = Math.max(0, row.o_goal_ml - row.o_total_ml)
      notices.set(row.o_user_id, {
        title: TITLES[Math.floor(Math.random() * TITLES.length)],
        body:
          remaining === 0
            ? `Goal reached (${(row.o_total_ml / 1000).toFixed(1)} L) — keep sipping steadily.`
            : `${(row.o_total_ml / 1000).toFixed(1)} of ${(row.o_goal_ml / 1000).toFixed(1)} L so far · ${remaining} ml to go.`,
      })
    }
    const stats = await pushToUsers(db, cfg, notices)
    return json({ due: notices.size, ...stats })
  } catch (e) {
    console.error('[send-reminders]', e)
    return json({ error: String(e) }, 500)
  }
})
