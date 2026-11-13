import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarCheck2, ChevronLeft, ChevronRight, Droplets, Flame, Table2, Trophy, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useDayLogs, useHistory, type DayPoint } from '@/hooks/useHistory'
import { useHydration } from '@/contexts/HydrationContext'
import { addDays, formatClock, startOfDay } from '@/lib/time'
import { cn } from '@/lib/utils'

export function History() {
  const [tab, setTab] = useState('week')
  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-fade-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your hydration over time.</p>
        </div>
        <TabsList>
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="day">
          <DailyView />
        </TabsContent>
        <TabsContent value="week">
          <RangeView days={7} title="Last 7 days" />
        </TabsContent>
        <TabsContent value="month">
          <RangeView days={30} title="Last 30 days" />
        </TabsContent>
    </Tabs>
  )
}

function StatGrid({ items }: { items: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(({ icon: Icon, label, value, sub }) => (
        <Card key={label}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span className="grid size-7 place-items-center rounded-full bg-accent text-primary">
                <Icon className="size-3.5" />
              </span>
              {label}
            </div>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const pct = p.goal ? Math.round((p.total / p.goal) * 100) : 0
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">
        {new Date(p.date + 'T00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
      </p>
      <p className="mt-1 tabular text-foreground">
        {p.total.toLocaleString()} ml <span className="text-muted-foreground">· {pct}% of goal</span>
      </p>
      <p className={cn('mt-0.5', p.completed ? 'text-success' : 'text-muted-foreground')}>
        {p.completed ? '✓ Goal met' : `Goal ${p.goal.toLocaleString()} ml`}
      </p>
    </div>
  )
}

function RangeView({ days, title }: { days: number; title: string }) {
  const { points, stats, loading, error } = useHistory(days)
  const { goal } = useHydration()
  const [showTable, setShowTable] = useState(false)
  const max = Math.max(goal * 1.1, ...points.map((p) => p.total))
  const step = max > 4000 ? 2000 : max > 2000 ? 1000 : 500
  const yMax = Math.ceil(max / step) * step
  const ticks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step)

  return (
    <div className="space-y-5">
      <StatGrid
        items={[
          { icon: TrendingUp, label: 'Daily average', value: stats.dailyAverage ? `${stats.dailyAverage.toLocaleString()} ml` : '—', sub: `${stats.trackedDays} tracked ${stats.trackedDays === 1 ? 'day' : 'days'}` },
          {
            icon: CalendarCheck2,
            label: 'Goal completion',
            value: stats.completionRate == null ? '—' : `${Math.round(stats.completionRate * 100)}%`,
            sub: stats.completionRate == null ? 'after your first full day' : 'of days since you started',
          },
          { icon: Flame, label: 'Current streak', value: `${stats.currentStreak} ${stats.currentStreak === 1 ? 'day' : 'days'}`, sub: 'consecutive goals met' },
          { icon: Trophy, label: 'Best streak', value: `${stats.bestStreak} ${stats.bestStreak === 1 ? 'day' : 'days'}`, sub: `Total ${(stats.totalMl / 1000).toFixed(1)} L in range` },
        ]}
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Daily intake · dashed line is your goal</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            <Table2 /> {showTable ? 'Chart' : 'Table'}
          </Button>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="py-16 text-center text-sm text-destructive">{error}</p>
          ) : loading ? (
            <Skeleton className="h-72" />
          ) : stats.trackedDays === 0 ? (
            <Empty text="No drinks logged in this period yet." />
          ) : showTable ? (
            <div className="max-h-80 overflow-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card-solid text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 text-right font-medium">Intake</th>
                    <th className="px-4 py-2 text-right font-medium">Goal</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((p) => (
                    <tr key={p.date} className="border-t">
                      <td className="px-4 py-2">{new Date(p.date + 'T00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                      <td className="px-4 py-2 text-right tabular">{p.total.toLocaleString()} ml</td>
                      <td className="px-4 py-2 text-right tabular text-muted-foreground">{p.goal.toLocaleString()} ml</td>
                      <td className={cn('px-4 py-2 text-right', p.completed ? 'text-success' : 'text-muted-foreground')}>{p.completed ? '✓ Met' : p.total ? 'Below' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 12, right: 4, left: -12, bottom: 0 }} barCategoryGap={days > 7 ? '22%' : '38%'}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    interval={days > 7 ? 'preserveStartEnd' : 0}
                    minTickGap={12}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    tickFormatter={(v: number) => (v === 0 ? '0' : v >= 1000 ? `${v / 1000} L` : `${v} ml`)}
                    domain={[0, yMax]}
                    ticks={ticks}
                    width={52}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--muted)', radius: 8 } as object} />
                  <ReferenceLine y={goal} stroke="var(--primary)" strokeDasharray="4 4" strokeOpacity={0.6} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {points.map((p) => (
                      <Cell key={p.date} fill={p.completed ? 'var(--chart-1)' : 'var(--chart-2)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {!loading && !error && stats.trackedDays > 0 && !showTable && (
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-1" /> Goal met</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-2" /> Below goal</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DailyView() {
  const [day, setDay] = useState(() => startOfDay(new Date()))
  const { logs, loading, error } = useDayLogs(day)
  const { goal } = useHydration()
  const isToday = day.getTime() === startOfDay(new Date()).getTime()
  const total = logs.reduce((s, l) => s + l.amount_ml, 0)

  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: `${h}`, total: 0 }))
    for (const l of logs) buckets[new Date(l.logged_at).getHours()].total += l.amount_ml
    const first = Math.min(6, ...logs.map((l) => new Date(l.logged_at).getHours()))
    const last = Math.max(22, ...logs.map((l) => new Date(l.logged_at).getHours()))
    return buckets.slice(first, last + 1).map((b) => ({
      ...b,
      label: new Date(2000, 0, 1, b.hour).toLocaleTimeString([], { hour: 'numeric' }),
    }))
  }, [logs])

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-4 sm:py-4">
          <Button variant="ghost" size="icon-sm" onClick={() => setDay((d) => addDays(d, -1))} aria-label="Previous day">
            <ChevronLeft />
          </Button>
          <div className="text-center">
            <p className="font-semibold">
              {isToday ? 'Today' : day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <p className="text-xs text-muted-foreground tabular">
              {total.toLocaleString()} ml of {goal.toLocaleString()} ml · {logs.length} {logs.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setDay((d) => addDays(d, 1))} disabled={isToday} aria-label="Next day">
            <ChevronRight />
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>By hour</CardTitle>
            <CardDescription>When you drank</CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <p className="py-16 text-center text-sm text-destructive">{error}</p>
            ) : loading ? (
              <Skeleton className="h-64" />
            ) : logs.length === 0 ? (
              <Empty text="Nothing logged on this day." />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 8, right: 4, left: -12, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} minTickGap={16} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} width={44} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: 'var(--muted)' }}
                      content={({ active, payload }) =>
                        active && payload?.length ? (
                          <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg">
                            <p className="font-medium">{(payload[0].payload as { label: string }).label}</p>
                            <p className="mt-1 tabular">{Number(payload[0].value).toLocaleString()} ml</p>
                          </div>
                        ) : null
                      }
                    />
                    <Bar dataKey="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entries</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries.</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-auto">
                {logs.map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-muted-foreground tabular">{formatClock(new Date(l.logged_at))}</span>
                    <span className="font-medium tabular">{l.amount_ml} ml</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
        <Droplets className="size-5" />
      </span>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
