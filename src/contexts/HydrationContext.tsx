/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAuth } from './AuthContext'
import { errorMessage, supabase } from '@/lib/supabase'
import { addDays, dateKey, localTimezone, startOfDay } from '@/lib/time'
import { validateAmount } from '@/lib/validation'
import type { HydrationLog, Profile, ReminderSettings } from '@/types/database'

type SettingsPatch = Partial<
  Pick<ReminderSettings, 'interval_minutes' | 'wake_time' | 'sleep_time' | 'notifications_enabled' | 'sound_enabled'>
>
type ProfilePatch = Partial<Pick<Profile, 'full_name' | 'daily_goal_ml' | 'timezone'>>

interface HydrationCtx {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  profile: Profile | null
  settings: ReminderSettings | null
  todayLogs: HydrationLog[]
  todayTotal: number
  goal: number
  lastLogAt: Date | null
  /** Increments after any write — history views use it to refetch. */
  version: number
  addWater: (amount: number | string) => Promise<boolean>
  undoLast: () => Promise<void>
  deleteLog: (id: string) => Promise<void>
  updateProfile: (patch: ProfilePatch) => Promise<boolean>
  updateSettings: (patch: SettingsPatch) => Promise<boolean>
  reload: () => Promise<void>
}

const Ctx = createContext<HydrationCtx | null>(null)
const DEFAULT_GOAL = 2500

export function HydrationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  // Token refreshes hand us a new `user` object; keep metadata in a ref so we
  // don't refetch everything each time.
  const metaNameRef = useRef<string | null>(null)
  metaNameRef.current = (user?.user_metadata?.full_name as string | undefined) ?? null

  const [status, setStatus] = useState<HydrationCtx['status']>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<ReminderSettings | null>(null)
  const [todayLogs, setTodayLogs] = useState<HydrationLog[]>([])
  const [version, setVersion] = useState(0)
  const [day, setDay] = useState(() => dateKey(new Date()))
  const pendingRef = useRef(0)

  const loadToday = useCallback(async (uid: string) => {
    const from = startOfDay(new Date())
    const to = addDays(from, 1)
    const { data, error } = await supabase
      .from('hydration_logs')
      .select('*')
      .eq('user_id', uid)
      .gte('logged_at', from.toISOString())
      .lt('logged_at', to.toISOString())
      .order('logged_at', { ascending: true })
    if (error) throw error
    return data ?? []
  }, [])

  const reload = useCallback(async () => {
    if (!userId) return
    setLoadError(null)
    try {
      const [p, s, logs] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('reminder_settings').select('*').eq('user_id', userId).maybeSingle(),
        loadToday(userId),
      ])
      if (p.error) throw p.error
      if (s.error) throw s.error

      let prof = p.data
      const tz = localTimezone()
      if (!prof) {
        // Safety net if the signup trigger didn't run (e.g. user created before migration).
        const ins = await supabase
          .from('profiles')
          .upsert({ id: userId, full_name: metaNameRef.current, timezone: tz })
          .select('*')
          .single()
        if (ins.error) throw ins.error
        prof = ins.data
      } else if (prof.timezone !== tz) {
        // Keep the profile timezone in sync with the device so summaries use the right day.
        const upd = await supabase.from('profiles').update({ timezone: tz }).eq('id', userId).select('*').single()
        if (!upd.error && upd.data) prof = upd.data
      }

      let sett = s.data
      if (!sett) {
        const ins = await supabase
          .from('reminder_settings')
          .upsert({ user_id: userId }, { onConflict: 'user_id' })
          .select('*')
          .single()
        if (ins.error) throw ins.error
        sett = ins.data
      }

      setProfile(prof)
      setSettings(sett)
      setTodayLogs(logs)
      setStatus('ready')
    } catch (e) {
      setLoadError(errorMessage(e))
      setStatus('error')
    }
  }, [userId, loadToday])

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setSettings(null)
      setTodayLogs([])
      setStatus('loading')
      return
    }
    setStatus('loading')
    void reload()
  }, [userId, reload])

  // Roll over to a new day at midnight, and refresh when the tab regains focus.
  useEffect(() => {
    if (!userId) return
    const check = () => {
      const k = dateKey(new Date())
      setDay((prev) => (prev === k ? prev : k))
    }
    const id = window.setInterval(check, 30_000)
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      check()
      // Pull in entries made on another device/tab while hidden.
      if (pendingRef.current === 0) {
        loadToday(userId)
          .then(setTodayLogs)
          .catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userId, loadToday])

  // Cross-tab sync: other open tabs learn about writes immediately.
  const bcRef = useRef<BroadcastChannel | null>(null)
  useEffect(() => {
    if (!userId || typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(`hydrate-sync-${userId}`)
    bcRef.current = bc
    bc.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; settings?: ReminderSettings; profile?: Profile }
      if (msg.type === 'settings' && msg.settings) setSettings(msg.settings)
      else if (msg.type === 'profile' && msg.profile) setProfile(msg.profile)
      else if (msg.type === 'logs') {
        loadToday(userId)
          .then((logs) => {
            setTodayLogs(logs)
            setVersion((v) => v + 1)
          })
          .catch(() => {})
      }
    }
    return () => {
      bc.close()
      bcRef.current = null
    }
  }, [userId, loadToday])
  const broadcast = useCallback((msg: unknown) => {
    try {
      bcRef.current?.postMessage(msg)
    } catch {
      /* ignore */
    }
  }, [])

  const firstDay = useRef(day)
  useEffect(() => {
    if (!userId || day === firstDay.current) return
    firstDay.current = day
    loadToday(userId)
      .then((logs) => {
        setTodayLogs(logs)
        setVersion((v) => v + 1)
      })
      .catch(() => {})
  }, [day, userId, loadToday])

  const addWater = useCallback(
    async (raw: number | string) => {
      if (!userId) return false
      const v = validateAmount(raw)
      if (!v.ok) {
        toast.error(v.error)
        return false
      }
      const now = new Date()
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: HydrationLog = {
        id: tempId,
        user_id: userId,
        amount_ml: v.value,
        logged_at: now.toISOString(),
        timezone: localTimezone(),
        created_at: now.toISOString(),
      }
      pendingRef.current++
      setTodayLogs((logs) => [...logs, optimistic])
      try {
        const { data, error } = await supabase
          .from('hydration_logs')
          .insert({ user_id: userId, amount_ml: v.value, logged_at: optimistic.logged_at, timezone: optimistic.timezone })
          .select('*')
          .single()
        if (error) throw error
        setTodayLogs((logs) => logs.map((l) => (l.id === tempId ? data : l)))
        setVersion((x) => x + 1)
        broadcast({ type: 'logs' })
        return true
      } catch (e) {
        setTodayLogs((logs) => logs.filter((l) => l.id !== tempId))
        toast.error("Couldn't save that drink", { description: errorMessage(e) })
        return false
      } finally {
        pendingRef.current--
      }
    },
    [userId, broadcast],
  )

  const deleteLog = useCallback(
    async (id: string) => {
      if (!userId || id.startsWith('temp-')) return
      let removed: HydrationLog | undefined
      setTodayLogs((logs) => {
        removed = logs.find((l) => l.id === id)
        return logs.filter((l) => l.id !== id)
      })
      pendingRef.current++
      try {
        const { error } = await supabase.from('hydration_logs').delete().eq('id', id).eq('user_id', userId)
        if (error) throw error
        setVersion((x) => x + 1)
        broadcast({ type: 'logs' })
      } catch (e) {
        if (removed) {
          const r = removed
          setTodayLogs((logs) => [...logs, r].sort((a, b) => a.logged_at.localeCompare(b.logged_at)))
        }
        toast.error("Couldn't remove entry", { description: errorMessage(e) })
      } finally {
        pendingRef.current--
      }
    },
    [userId, broadcast],
  )

  const undoLast = useCallback(async () => {
    const last = [...todayLogs].reverse().find((l) => !l.id.startsWith('temp-'))
    if (!last) {
      toast('Nothing to undo today')
      return
    }
    await deleteLog(last.id)
    toast(`Removed ${last.amount_ml} ml`)
  }, [todayLogs, deleteLog])

  const updateProfile = useCallback(
    async (patch: ProfilePatch) => {
      if (!userId || !profile) return false
      const prev = profile
      setProfile({ ...profile, ...patch })
      const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select('*').single()
      if (error) {
        setProfile(prev)
        toast.error("Couldn't save profile", { description: errorMessage(error) })
        return false
      }
      setProfile(data)
      setVersion((x) => x + 1)
      broadcast({ type: 'profile', profile: data })
      return true
    },
    [userId, profile, broadcast],
  )

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => {
      if (!userId || !settings) return false
      const prev = settings
      setSettings({ ...settings, ...patch })
      const { data, error } = await supabase
        .from('reminder_settings')
        .update(patch)
        .eq('user_id', userId)
        .select('*')
        .single()
      if (error) {
        setSettings(prev)
        toast.error("Couldn't save reminder settings", { description: errorMessage(error) })
        return false
      }
      setSettings(data)
      broadcast({ type: 'settings', settings: data })
      return true
    },
    [userId, settings, broadcast],
  )

  const todayTotal = useMemo(() => todayLogs.reduce((s, l) => s + l.amount_ml, 0), [todayLogs])
  const lastLogAt = useMemo(() => {
    const last = todayLogs[todayLogs.length - 1]
    return last ? new Date(last.logged_at) : null
  }, [todayLogs])

  const value = useMemo<HydrationCtx>(
    () => ({
      status,
      loadError,
      profile,
      settings,
      todayLogs,
      todayTotal,
      goal: profile?.daily_goal_ml ?? DEFAULT_GOAL,
      lastLogAt,
      version,
      addWater,
      undoLast,
      deleteLog,
      updateProfile,
      updateSettings,
      reload,
    }),
    [status, loadError, profile, settings, todayLogs, todayTotal, lastLogAt, version, addWater, undoLast, deleteLog, updateProfile, updateSettings, reload],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useHydration() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useHydration must be used within HydrationProvider')
  return v
}
