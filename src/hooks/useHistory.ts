import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useHydration } from '@/contexts/HydrationContext'
import { errorMessage, supabase } from '@/lib/supabase'
import { addDays, dateKey, parseDateKey, startOfDay } from '@/lib/time'
import type { DailySummary, HydrationLog } from '@/types/database'

export interface DayPoint {
  date: string
  label: string
  total: number
  goal: number
  completed: boolean
}

export interface HistoryStats {
  dailyAverage: number
  /** null until there's at least one finished (or completed) day to judge */
  completionRate: number | null
  currentStreak: number
  bestStreak: number
  trackedDays: number
  totalMl: number
}

/** Pure: streaks from a set of completed date keys. Today not yet complete doesn't break the streak. */
export function computeStreaks(completed: Set<string>, today = new Date()): { current: number; best: number } {
  let current = 0
  let cursor = startOfDay(today)
  if (!completed.has(dateKey(cursor))) cursor = addDays(cursor, -1)
  while (completed.has(dateKey(cursor))) {
    current++
    cursor = addDays(cursor, -1)
  }
  const sorted = [...completed].sort()
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const k of sorted) {
    const d = parseDateKey(k)
    run = prev && dateKey(addDays(prev, 1)) === k ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return { current, best: Math.max(best, current) }
}

/** Summaries for the last `days` days (including today), gap-filled, plus aggregate stats. */
export function useHistory(days: number) {
  const { user } = useAuth()
  const { version, todayTotal, goal, todayLogs } = useHydration()
  const [rows, setRows] = useState<DailySummary[]>([])
  const [completedDates, setCompletedDates] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const from = dateKey(addDays(new Date(), -(days - 1)))
    setError(null)
    Promise.all([
      supabase
        .from('daily_summaries')
        .select('*')
        .eq('user_id', user.id)
        .gte('summary_date', from)
        .order('summary_date', { ascending: true }),
      supabase
        .from('daily_summaries')
        .select('summary_date')
        .eq('user_id', user.id)
        .eq('goal_completed', true)
        .order('summary_date', { ascending: false })
        .limit(400),
    ])
      .then(([range, streak]) => {
        if (cancelled) return
        if (range.error) throw range.error
        if (streak.error) throw streak.error
        setRows(range.data ?? [])
        setCompletedDates((streak.data ?? []).map((r) => r.summary_date))
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [user, days, version])

  const todayKey = dateKey(new Date())
  const result = useMemo(() => {
    const byDate = new Map(rows.map((r) => [r.summary_date, r]))
    const points: DayPoint[] = []
    const start = addDays(startOfDay(new Date()), -(days - 1))
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i)
      const k = dateKey(d)
      const r = byDate.get(k)
      // Use live in-memory numbers for today so charts react instantly.
      const total = k === todayKey ? todayTotal : (r?.total_ml ?? 0)
      const g = k === todayKey ? goal : (r?.goal_ml ?? goal)
      points.push({
        date: k,
        label:
          days <= 7
            ? d.toLocaleDateString([], { weekday: 'short' })
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        total,
        goal: g,
        completed: total >= g && total > 0,
      })
    }

    const completed = new Set(completedDates)
    if (todayTotal >= goal && todayTotal > 0) completed.add(todayKey)
    else completed.delete(todayKey)
    const { current, best } = computeStreaks(completed)

    const tracked = points.filter((p) => p.total > 0)
    const firstIdx = points.findIndex((p) => p.total > 0)
    // Completion rate counts days since tracking began; an unfinished today isn't held against you.
    const window = firstIdx === -1 ? [] : points.slice(firstIdx).filter((p) => p.date !== todayKey || p.completed)
    const stats: HistoryStats = {
      dailyAverage: tracked.length ? Math.round(tracked.reduce((s, p) => s + p.total, 0) / tracked.length) : 0,
      completionRate: window.length ? window.filter((p) => p.completed).length / window.length : null,
      currentStreak: current,
      bestStreak: best,
      trackedDays: tracked.length,
      totalMl: points.reduce((s, p) => s + p.total, 0),
    }
    return { points, stats }
    // todayLogs included so today's point refreshes on every log
  }, [rows, completedDates, days, todayKey, todayTotal, goal, todayLogs]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...result, loading, error }
}

/** Raw logs for a single local day (for the Daily view). */
export function useDayLogs(day: Date) {
  const { user } = useAuth()
  const { version } = useHydration()
  const [logs, setLogs] = useState<HydrationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const key = dateKey(day)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const from = parseDateKey(key)
    const to = addDays(from, 1)
    setLoading(true)
    setError(null)
    supabase
      .from('hydration_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('logged_at', from.toISOString())
      .lt('logged_at', to.toISOString())
      .order('logged_at', { ascending: true })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) setError(errorMessage(err))
        else setLogs(data ?? [])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, key, version])

  return { logs, loading, error }
}
