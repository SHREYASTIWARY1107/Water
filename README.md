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
2. When it's ready, open **SQL Editor → New query**, paste the contents of
   [`supabase/migrations/20261113000000_init_hydrate.sql`](supabase/migrations/20261113000000_init_hydrate.sql) and click **Run**.
   (Or with the Supabase CLI: `npx supabase link --project-ref <ref> && npx supabase db push`.)
3. **Authentication → URL Configuration**
   - **Site URL**: `http://localhost:5173` for local dev (later your deployed URL, e.g. `https://<user>.github.io/hydrate/`).
   - **Redirect URLs**: add both of the above.
4. **Authentication → Providers → Email**: enabled by default. Leave *Confirm email* on for production; switch it off while developing if you want instant sign-up.
5. **Project Settings → API** (or the **Connect** button): copy the **Project URL** and the **anon / publishable** key.

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
| `npm test` | Unit tests for the reminder scheduler and streak logic (Vitest) |
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

For this MVP the scheduler runs **in the browser**:

> **Keep a Hydrate tab open.** It can be in the background or minimised, but if the browser is closed, no reminders fire.
> Installing it as an app (Chrome → ⋮ → *Cast, save and share → Install*; Safari → *File → Add to Dock*) keeps it running unobtrusively.

Reliability safeguards in [`src/reminders/`](src/reminders):

| Concern | How it's handled |
|---|---|
| Background-tab timer throttling | Ticks come from a dedicated **Web Worker** (exempt from Chrome's intensive throttling) plus a precise main-thread timeout. |
| Laptop sleep / frozen tab | Re-evaluates on `visibilitychange`, `focus`, `pageshow` and `online`. Missed slots collapse into **one** catch-up reminder. |
| Waking hours | `decide()` never fires outside `[wake, sleep)`; a slot missed overnight is skipped silently and the next reminder is moved to wake-up time. |
| Duplicate notifications | Schedule state lives in `localStorage` and the fire decision runs inside a **Web Lock**, so only one tab fires per slot. Notifications also share a `tag`, so the OS replaces rather than stacks them. |
| Drinking resets the clock | The next reminder is `interval` after the latest of: reminder fired, water logged, or reminders started/resumed. |
| Permission denied | Reminders still appear **in-app** (toast) while the page is visible. |
| Sound | Soft two-note chime via Web Audio (unlocked on your first click). Falls back to the OS sound if audio is locked. |
| Android | Notifications are shown through the service worker (`public/sw.js`), which is also what enables the action buttons. |

### Web Push roadmap (closed-browser reminders)

The engine only talks to the `ReminderChannel` interface (`src/reminders/channels.ts`) and the scheduling math is pure (`src/reminders/schedule.ts`). To add true push:

1. Generate VAPID keys; subscribe with `registration.pushManager.subscribe()` and store the subscription in a new `push_subscriptions` table (RLS: own rows).
2. A Supabase Edge Function on a cron (every 5 min) reuses `schedule.ts` against `reminder_settings` + latest `hydration_logs`, and sends pushes with `web-push`.
3. `public/sw.js` already handles the `push` event. Disable the client scheduler when a push subscription is active.

---

## Database

`supabase/migrations/20261113000000_init_hydrate.sql` creates:

| Table | Notes |
|---|---|
| `profiles` | `id` → `auth.users`, `full_name`, `daily_goal_ml` (500–10000, default 2500), `timezone`, `created_at`. Auto-created on sign-up. |
| `hydration_logs` | `id`, `user_id`, `amount_ml` (1–5000), `logged_at`, `timezone` (the device's IANA zone at logging time), `created_at`. Index on `(user_id, logged_at desc)`. |
| `reminder_settings` | One row per user (`user_id` unique): `interval_minutes` ∈ {30,45,60,90}, `wake_time`, `sleep_time` (must differ), `notifications_enabled` (running / paused), `sound_enabled`. Auto-created on sign-up. |
| `daily_summaries` | `(user_id, summary_date)` unique; `total_ml`, `goal_ml`, `goal_completed`, `entry_count`. **Maintained by triggers** on `hydration_logs` using each log's local date. Read-only for clients. |

Every table has RLS enabled with `auth.uid()`-scoped policies. `anon` has no table access.

## Project structure

```
src/
  components/      UI pieces (WaterBottle, QuickAdd, Timeline, ReminderCard, AppShell) + ui/ (shadcn)
  contexts/        Theme, Auth (Supabase listener), Hydration (data + optimistic writes), Reminder (engine wiring)
  hooks/           useHistory (summaries, stats, streaks)
  reminders/       schedule.ts (pure), engine.ts, channels.ts, sound.ts, __tests__/
  pages/           AuthPage, Dashboard, History, Reminders, Settings
  lib/             supabase client, time + validation helpers
supabase/migrations/   SQL schema, triggers, RLS
public/sw.js           service worker (notifications, actions, push stub)
```

## Troubleshooting

- **"Connect Supabase to get started" screen**: `.env.local` is missing or the dev server wasn't restarted.
- **Sign-up says "check your inbox"**: email confirmation is on. Confirm via the link, or disable it in Supabase for dev.
- **Sign-up fails with "Email address … is invalid" / "not authorized"**: Supabase's built-in email sender only delivers to your project's team members and is heavily rate-limited. For real users either turn **Confirm email** off (Authentication → Sign In / Providers → Email) or configure custom SMTP (Authentication → Emails → SMTP).
- **No system notifications**: check the site's notification permission (padlock icon in the address bar) and OS Focus / Do Not Disturb. Use **Reminders → Test**.
- **macOS**: System Settings → Notifications → your browser → Allow notifications.
