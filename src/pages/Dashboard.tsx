import { Flame, PartyPopper, Target, TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { WaterBottle } from '@/components/WaterBottle'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { QuickAdd } from '@/components/QuickAdd'
import { Timeline } from '@/components/Timeline'
import { ReminderCard } from '@/components/ReminderCard'
import { useHydration } from '@/contexts/HydrationContext'
import { useHistory } from '@/hooks/useHistory'
import { greeting } from '@/lib/time'

export function Dashboard() {
  const { profile, todayTotal, goal } = useHydration()
  const { stats } = useHistory(30)
  const pct = goal > 0 ? todayTotal / goal : 0
  const remaining = Math.max(0, goal - todayTotal)
  const done = todayTotal >= goal
  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <div className="space-y-6">
      <div className="animate-fade-up">
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}.
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Hero */}
        <Card className="relative min-w-0 overflow-hidden animate-fade-up">
          <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[var(--water-2)]/15 blur-3xl" />
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
            <WaterBottle progress={pct} className="h-72 w-36 shrink-0 sm:h-80 sm:w-40" />
            <div className="w-full min-w-0 flex-1 space-y-6">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Consumed today</p>
                <p className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">
                  <AnimatedNumber value={todayTotal} />
                  <span className="ml-1.5 text-xl font-medium text-muted-foreground">ml</span>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  of {goal.toLocaleString()} ml daily goal
                </p>
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between text-sm">
                  <span className="font-medium text-primary">
                    <AnimatedNumber value={Math.round(pct * 100)} />%
                  </span>
                  <span className="text-muted-foreground">
                    {done ? 'Goal reached' : `${remaining.toLocaleString()} ml to go`}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--water-1)] to-[var(--water-3)] transition-[width] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ width: `${Math.min(100, pct * 100)}%` }}
                  />
                </div>
              </div>

              {done ? (
                <div className="flex items-center gap-3 rounded-2xl bg-success/10 px-4 py-3 text-sm text-success animate-fade-up">
                  <PartyPopper className="size-5 shrink-0" />
                  <span className="font-medium">Beautifully done — today’s goal is complete.</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Stat icon={Target} label="Remaining" value={`${remaining}`} unit="ml" />
                  <Stat icon={Flame} label="Streak" value={`${stats.currentStreak}`} unit={stats.currentStreak === 1 ? 'day' : 'days'} />
                  <Stat icon={TrendingUp} label="30d avg" value={stats.dailyAverage ? `${(stats.dailyAverage / 1000).toFixed(1)}` : '—'} unit={stats.dailyAverage ? 'L' : ''} />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <div className="animate-fade-up [animation-delay:60ms]">
            <ReminderCard compact />
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <QuickAdd />
          </div>
        </div>
      </div>

      <div className="animate-fade-up [animation-delay:180ms]">
        <Timeline />
      </div>
    </div>
  )
}

function Stat({ icon: Icon, label, value, unit }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-secondary/70 px-2.5 py-3 sm:px-3">
      <div className="flex items-center gap-1 truncate text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="mt-1 text-lg font-semibold tracking-tight tabular">
        {value}
        <span className="ml-0.5 text-xs font-medium text-muted-foreground">{unit}</span>
      </p>
    </div>
  )
}
