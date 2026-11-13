import { useEffect, useState } from 'react'
import { BellOff, BellRing, Moon, Pause, Play, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useReminders } from '@/contexts/ReminderContext'
import { useHydration } from '@/contexts/HydrationContext'
import { formatClock, formatDuration, formatTimeOfDay } from '@/lib/time'
import { cn } from '@/lib/utils'

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function ReminderCard({ compact = false }: { compact?: boolean }) {
  const { snapshot, enabled, everStarted, permission, start, pause, test } = useReminders()
  const { settings } = useHydration()
  const [busy, setBusy] = useState(false)
  const now = useNow(enabled)

  const remaining = snapshot.nextAt ? snapshot.nextAt - now : null
  const intervalMs = (settings?.interval_minutes ?? 60) * 60_000
  const ring = remaining != null && snapshot.status === 'active' ? Math.max(0, Math.min(1, 1 - remaining / intervalMs)) : 0

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const R = 34
  const C = 2 * Math.PI * R

  return (
    <Card className="overflow-hidden">
      <CardContent className={cn('flex flex-wrap items-center gap-x-5 gap-y-4 sm:flex-nowrap', compact && 'gap-x-4')}>
        <div className="relative size-18 shrink-0 sm:size-20">
          <svg viewBox="0 0 80 80" className="size-full -rotate-90">
            <circle cx="40" cy="40" r={R} className="fill-none stroke-secondary" strokeWidth="6" />
            <circle
              cx="40"
              cy="40"
              r={R}
              className="fill-none stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - ring)}
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-primary">
            {!enabled ? (
              <BellOff className="size-6 text-muted-foreground" />
            ) : snapshot.status === 'resting' ? (
              <Moon className="size-6" />
            ) : (
              <BellRing className="size-6 origin-top animate-[wiggle_2.4s_ease-in-out_infinite]" />
            )}
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-40">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {!enabled ? (everStarted ? 'Reminders paused' : 'Reminders off') : snapshot.status === 'resting' ? 'Resting — outside waking hours' : 'Next reminder'}
          </p>
          {enabled && snapshot.nextAt ? (
            <>
              <p className="text-3xl font-semibold tracking-tight tabular" aria-live="polite">
                {snapshot.status === 'resting' ? formatClock(new Date(snapshot.nextAt)) : formatDuration(remaining ?? 0)}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {snapshot.status === 'resting'
                  ? 'Reminders resume when you wake up'
                  : `at ${formatClock(new Date(snapshot.nextAt))} · every ${settings?.interval_minutes} min`}
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {settings
                ? `Every ${settings.interval_minutes} min, ${formatTimeOfDay(settings.wake_time)} – ${formatTimeOfDay(settings.sleep_time)}`
                : 'Loading…'}
            </p>
          )}
          {enabled && permission !== 'granted' && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {permission === 'denied' ? 'Notifications blocked — showing in-app alerts.' : 'Allow notifications for system alerts.'}
            </p>
          )}
        </div>

        <div className="flex w-full shrink-0 gap-2 sm:w-auto sm:flex-col [&>*]:flex-1 sm:[&>*]:flex-none">
          {enabled ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(pause)}>
              <Pause /> Pause
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !settings} onClick={() => run(start)}>
              <Play /> {everStarted ? 'Resume' : 'Start'}
            </Button>
          )}
          {!compact && (
            <Button variant="ghost" size="sm" onClick={() => run(test)} disabled={busy}>
              <Send /> Test
            </Button>
          )}
          {compact && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reminders">Settings</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
