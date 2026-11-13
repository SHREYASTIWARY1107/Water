/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useAuth } from './AuthContext'
import { useHydration } from './HydrationContext'
import { ReminderEngine, type EngineSnapshot } from '@/reminders/engine'
import {
  BrowserNotificationChannel,
  notificationPermission,
  requestNotificationPermission,
  type PermissionState,
} from '@/reminders/channels'
import { unlockAudio } from '@/reminders/sound'
import { parseTimeOfDay } from '@/lib/time'

interface ReminderCtx {
  snapshot: EngineSnapshot
  permission: PermissionState
  enabled: boolean
  /** True once the user has started reminders at least once on this device. */
  everStarted: boolean
  start: () => Promise<void>
  pause: () => Promise<void>
  test: () => Promise<void>
  requestPermission: () => Promise<PermissionState>
}

const Ctx = createContext<ReminderCtx | null>(null)
const EMPTY: EngineSnapshot = { status: 'off', nextAt: null, lastFiredAt: null, windowEndsAt: null }

export function ReminderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { settings, updateSettings, lastLogAt, todayTotal, goal, addWater } = useHydration()
  const userId = user?.id ?? null
  const engineRef = useRef<ReminderEngine | null>(null)
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY)
  const [permission, setPermission] = useState<PermissionState>(notificationPermission)
  const startedKey = userId ? `hydrate:reminders-started:${userId}` : null
  const [everStarted, setEverStarted] = useState(false)

  useEffect(() => {
    if (!startedKey) return
    try {
      setEverStarted(localStorage.getItem(startedKey) === '1')
    } catch {
      /* ignore */
    }
  }, [startedKey])

  // One engine per signed-in user.
  useEffect(() => {
    if (!userId) return
    const channel = new BrowserNotificationChannel((p) => {
      toast(p.title, { description: p.body, duration: 10_000 })
    })
    const engine = new ReminderEngine(userId, channel)
    engineRef.current = engine
    const unsub = engine.subscribe(setSnapshot)
    return () => {
      unsub()
      engine.destroy()
      engineRef.current = null
      setSnapshot(EMPTY)
    }
  }, [userId])

  // Feed settings + latest drink into the engine.
  const wake = settings ? parseTimeOfDay(settings.wake_time) : null
  const sleep = settings ? parseTimeOfDay(settings.sleep_time) : null
  const lastLogMs = lastLogAt?.getTime() ?? null
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !settings || wake == null || sleep == null) return
    engine.configure({
      enabled: settings.notifications_enabled,
      intervalMinutes: settings.interval_minutes,
      window: { wake, sleep },
      soundEnabled: settings.sound_enabled,
      lastLogAt: lastLogMs,
      totalMl: todayTotal,
      goalMl: goal,
    })
  }, [settings, wake, sleep, lastLogMs, todayTotal, goal, userId])

  // Keep permission state fresh (user may change it in browser settings).
  useEffect(() => {
    const refresh = () => setPermission(notificationPermission())
    document.addEventListener('visibilitychange', refresh)
    let status: PermissionStatus | null = null
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((s) => {
        status = s
        s.onchange = refresh
      })
      .catch(() => {})
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      if (status) status.onchange = null
    }
  }, [])

  // Handle notification action buttons routed from the service worker.
  const addWaterRef = useRef(addWater)
  addWaterRef.current = addWater
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; amount?: number; minutes?: number } | null
      if (data?.type === 'log-water' && typeof data.amount === 'number') {
        void addWaterRef.current(data.amount).then((ok) => ok && toast.success(`Logged ${data.amount} ml from notification`))
      } else if (data?.type === 'snooze' && typeof data.minutes === 'number') {
        engineRef.current?.snooze(data.minutes)
        toast(`Snoozed for ${data.minutes} minutes`)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [])

  // Opened from a notification while no tab was open: ?log=250
  const settingsReady = !!settings
  useEffect(() => {
    if (!settingsReady) return
    const url = new URL(window.location.href)
    const amount = url.searchParams.get('log')
    if (amount && /^\d+$/.test(amount)) {
      url.searchParams.delete('log')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
      void addWaterRef.current(Number(amount))
    }
  }, [settingsReady])

  const requestPermission = useCallback(async () => {
    const p = await requestNotificationPermission()
    setPermission(p)
    return p
  }, [])

  const start = useCallback(async () => {
    unlockAudio() // we're inside a click handler — allowed to start audio
    const p = await requestPermission()
    if (p === 'denied') {
      toast.warning('Notifications are blocked', {
        description: 'Reminders will appear inside Hydrate while it is open. Allow notifications in your browser’s site settings for system alerts.',
        duration: 9000,
      })
    } else if (p === 'unsupported') {
      toast.warning('This browser does not support notifications — in-app reminders only.')
    }
    const ok = await updateSettings({ notifications_enabled: true })
    if (ok) {
      if (startedKey) {
        try {
          localStorage.setItem(startedKey, '1')
        } catch {
          /* ignore */
        }
      }
      setEverStarted(true)
      toast.success(everStarted ? 'Reminders resumed' : 'Reminders started', {
        description: 'Keep Hydrate open in a tab (it can be in the background).',
      })
    }
  }, [requestPermission, updateSettings, startedKey, everStarted])

  const pause = useCallback(async () => {
    const ok = await updateSettings({ notifications_enabled: false })
    if (ok) toast('Reminders paused')
  }, [updateSettings])

  const test = useCallback(async () => {
    unlockAudio()
    let p = permission
    if (p === 'default') p = await requestPermission()
    const res = await engineRef.current?.test()
    if (res === 'in-app' && p !== 'granted') {
      toast.message('Showing in-app only', { description: 'Allow notifications to get system alerts.' })
    }
  }, [permission, requestPermission])

  const value = useMemo<ReminderCtx>(
    () => ({
      snapshot,
      permission,
      enabled: settings?.notifications_enabled ?? false,
      everStarted,
      start,
      pause,
      test,
      requestPermission,
    }),
    [snapshot, permission, settings?.notifications_enabled, everStarted, start, pause, test, requestPermission],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReminders() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReminders must be used within ReminderProvider')
  return v
}
