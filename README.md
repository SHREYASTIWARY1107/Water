# 💧 Hydrate — Water Reminder & Hydration Tracker

A calm, Apple-inspired hydration tracker with **reliable, sleep-aware reminders**.
Built with React + Vite + TypeScript, Tailwind CSS, shadcn/ui, Supabase (Auth + Postgres), Recharts and the Browser Notifications API.

- **Dashboard** – animated water bottle, consumed / remaining / % of goal, quick-add (150 / 250 / 500 ml), custom amount, undo, today's timeline.
- **History** – daily (by hour), weekly and monthly charts; daily average, goal-completion rate, current & best streak; table view.
- **Reminders** – 30 / 45 / 60 / 90-minute intervals, custom wake & bed times (overnight windows supported), start / pause / resume, live countdown, gentle chime, notification actions (**Log 250 ml**, **Snooze 10 min**), test button.
- **Auth** – email/password sign up & sign in, persistent sessions, protected routes, per-user data isolation via Row Level Security.
- Light / dark / system theme, fully responsive (iOS-style tab bar on mobile).

---

## 1. Create a Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**. Pick a name, a strong DB password and a region near you.
2. Apply the migrations in [`supabase/migrations/`](supabase/migrations) **in filename order** (SQL Editor → New query → paste → Run),
   or with the CLI: `npx supabase link --project-ref <ref> && npx supabase db push`.
   In `*_push_cron.sql`, replace the project ref in the function URL with yours.
3. Deploy the push edge functions (both with JWT verification **off**; they authenticate themselves):
   ```bash
   npx supabase functions deploy send-reminders --no-verify-jwt
   npx supabase functions deploy push-action --no-verify-jwt
   ```
   VAPID keys are generated automatically on the first scheduler run and stored in Supabase Vault.
4. **Authentication → URL Configuration**
   - **Site URL**: `http://localhost:5173` for local dev (later your deployed URL, e.g. `https://<user>.github.io/hydrate/`).
   - **Redirect URLs**: add both of the above.
5. **Authentication → Providers → Email**: enabled by default. Leave *Confirm email* on for production; switch it off while developing if you want instant sign-up.
6. **Project Settings → API** (or the **Connect** button): copy the **Project URL** and the **anon / publishable** key.

> ⚠️ Never use the `service_role` / secret key in this app. It bypasses RLS. The frontend refuses to start if one is supplied.

## 2. Run locally

Requires Node 20+.

```bash
git clone <your-repo-url> hydrate && cd hydrate
npm install
cp .env.example .env.local      # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                     # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm test` | Unit tests: reminder scheduler, streaks, Web Push encryption/VAPID (Vitest) |
| `node scripts/gen-icons.mjs` | Regenerate PNG app icons from `public/icons/icon.svg` |
| `npm run typecheck` | TypeScript project check |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## 3. Deploy to GitHub Pages

The repo includes `.github/workflows/deploy.yml`.

1. Push to a GitHub repository (branch `main`).
2. **Settings → Pages → Source: GitHub Actions**.
3. **Settings → Secrets and variables → Actions → Variables** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
   (The anon key is public by design; RLS protects the data.)
4. Push again (or run the workflow manually). The site appears at `https://<user>.github.io/<repo>/`.
5. Add that URL to Supabase **Site URL / Redirect URLs**.

The app uses a hash router (`/#/history`), so no server rewrite rules are needed. It also works on Vercel/Netlify: just set the two env vars.

---

## How reminders work (please read)

Reminders are delivered two ways, and the app picks the best one per device automatically:

**1. Background push (preferred).** When you tap **Start** and allow notifications, the device subscribes to Web Push.
A Supabase cron job runs every minute, finds users whose reminder is due **in their own timezone and waking hours**, and sends
an encrypted push to each of their devices, so reminders arrive **even when Hydrate is closed**. On iPhone/iPad this needs
iOS 16.4+ and Hydrate added to the Home Screen (Safari → Share → *Add to Home Screen*, then open it from that icon).
**Reminders → Test** sends a real push end-to-end.

```
pg_cron (every minute) ─▶ edge fn send-reminders ─▶ claim_due_push_reminders()  (row-locked, stamps last_reminded_at)
                                         └─▶ RFC 8291 encrypt + VAPID ─▶ Apple / Google / Mozilla push ─▶ sw.js shows it
Notification buttons (Log 250 ml / Snooze) ─▶ sw.js ─▶ edge fn push-action (per-device action token, no session needed)
```

**2. In-browser scheduler (fallback).** Where push isn't available (e.g. iPhone Safari tab, push blocked), a client
scheduler runs while a Hydrate tab is open (background/minimised is fine). When push is active on a device, the local
scheduler only drives the countdown and never notifies, so you never get two notifications for one reminder.

| Concern | How it's handled |
|---|---|
| Same rules everywhere | Due = latest of (started/resumed, last reminder, last drink) + interval, or a snooze; only inside `[wake, sleep)` (overnight windows supported). Client: `src/reminders/schedule.ts`; server: `claim_due_push_reminders()`. |
| Duplicates | Server claims due rows with `FOR UPDATE SKIP LOCKED` and stamps them; client tabs coordinate via `localStorage` + a Web Lock; notifications share a `tag`/push `Topic` so the OS replaces rather than stacks. |
| Background throttling / sleep (fallback) | Web Worker ticks + re-checks on `visibilitychange`/`focus`/`pageshow`/`online`; missed slots collapse into one catch-up, never outside waking hours. |
| Dead devices | Push endpoints returning 404/410 (or failing 10× in a row) are deleted automatically. |
| Shared devices | Signing out unsubscribes the browser so the next account there doesn't get your reminders. |
| Secrets | VAPID private key and cron secret live in **Supabase Vault**; only the public VAPID key is exposed (via RPC). |
| Permission denied | Reminders still appear **in-app** (toast + chime) while the page is visible. |

## Database

`supabase/migrations/20261113000000_init_hydrate.sql` creates:

| Table | Notes |
|---|---|
| `profiles` | `id` → `auth.users`, `full_name`, `daily_goal_ml` (500–10000, default 2500), `timezone`, `created_at`. Auto-created on sign-up. |
| `hydration_logs` | `id`, `user_id`, `amount_ml` (1–5000), `logged_at`, `timezone` (the device's IANA zone at logging time), `created_at`. Index on `(user_id, logged_at desc)`. |
| `reminder_settings` | One row per user (`user_id` unique): `interval_minutes` ∈ {30,45,60,90}, `wake_time`, `sleep_time` (must differ), `notifications_enabled` (running / paused), `sound_enabled`. Auto-created on sign-up. |
| `daily_summaries` | `(user_id, summary_date)` unique; `total_ml`, `goal_ml`, `goal_completed`, `entry_count`. **Maintained by triggers** on `hydration_logs` using each log's local date. Read-only for clients. |
| `push_subscriptions` | One row per device push endpoint (`endpoint` unique, `p256dh`, `auth`, private `action_token`). Managed via `register_push_subscription` / `unregister_push_subscription` RPCs. |

`reminder_settings` also carries server schedule state for push: `resumed_at`, `last_reminded_at`, `snooze_until`, `snoozed_at`.

Every table has RLS enabled with `auth.uid()`-scoped policies. `anon` has no table access.

## Project structure

```
src/
  components/      UI pieces (WaterBottle, QuickAdd, Timeline, ReminderCard, AppShell) + ui/ (shadcn)
  contexts/        Theme, Auth (Supabase listener), Hydration (data + optimistic writes), Reminder (engine wiring)
  hooks/           useHistory (summaries, stats, streaks)
  reminders/       schedule.ts (pure), engine.ts, channels.ts, sound.ts, __tests__/
  pages/           AuthPage, Dashboard, History, Reminders, Settings
  lib/             supabase client, push subscription, time + validation helpers
supabase/migrations/   SQL schema, triggers, RLS, push + cron
supabase/functions/    send-reminders, push-action, _shared/webpush.ts (RFC 8291/8292 on WebCrypto)
public/sw.js           service worker (push, notifications, action buttons)
public/manifest.webmanifest + icons/   installable web app (needed for iPhone notifications)
```

## Troubleshooting

- **"Connect Supabase to get started" screen**: `.env.local` is missing or the dev server wasn't restarted.
- **Sign-up says "check your inbox"**: email confirmation is on. Confirm via the link, or disable it in Supabase for dev.
- **Sign-up fails with "Email address … is invalid" / "not authorized"**: Supabase's built-in email sender only delivers to your project's team members and is heavily rate-limited. For real users either turn **Confirm email** off (Authentication → Sign In / Providers → Email) or configure custom SMTP (Authentication → Emails → SMTP).
- **iPhone says notifications aren't supported**: add Hydrate to the Home Screen and open it from that icon (iOS 16.4+).
- **Background reminders say "Off"**: tap **Start** (or **Test**) after allowing notifications; check Supabase → Edge Functions logs for `send-reminders`.
- **No system notifications**: check the site's notification permission (padlock icon in the address bar) and OS Focus / Do Not Disturb. Use **Reminders → Test**.
- **macOS**: System Settings → Notifications → your browser → Allow notifications.
