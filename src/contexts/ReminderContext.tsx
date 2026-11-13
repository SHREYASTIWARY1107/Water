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
  type ReminderChannel,
} from '@/reminders/channels'
import { playChime, unlockAudio } from '@/reminders/sound'
import { ensurePushSubscription, lastPushError, prefetchPush, pushSupported, sendTestPush, type PushStatus } from '@/lib/push'
import { errorMessage } from '@/lib/supabase'
import { parseTimeOfDay } from '@/lib/time'

interface ReminderCtx {
  snapshot: EngineSnapshot
  permission: PermissionState
  /** Background (server-sent) push on this device. */
  push: PushStatus
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
const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

export function ReminderProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { settings, updateSettings, lastLogAt, todayTotal, goal, addWater, reload } = useHydration()
  const userId = user?.id ?? null
  const engineRef = useRef<ReminderEngine | null>(null)
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY)
  const [permission, setPermission] = useState<PermissionState>(notificationPermission)
  const [push, setPush] = useState<PushStatus>(() => (pushSupported() ? 'inactive' : 'unsupported'))
  const pushRef = useRef(push)
  pushRef.current = push
  const soundRef = useRef(true)
  soundRef.current = settings?.sound_enabled ?? true
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
    const inApp = (p: { title: string; body: string }) => toast(p.title, { description: p.body, duration: 10_000 })
    const browser = new BrowserNotificationChannel(inApp)
    // When this device receives server push, the server is the one notifying — the local
    // scheduler only drives the countdown, so there are never two notifications for one reminder.
    const channel: ReminderChannel = {
      name: 'adaptive',
      deliver: (p) => (pushRef.current === 'active' ? Promise.resolve('notification') : browser.deliver(p)),
    }
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

  // Feed settings + latest drink + server schedule state into the engine.
  const wake = settings ? parseTimeOfDay(settings.wake_time) : null
  const sleep = settings ? parseTimeOfDay(settings.sleep_time) : null
  const lastLogMs = lastLogAt?.getTime() ?? null
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !settings || wake == null || sleep == null) return
    const resumed = ms(settings.resumed_at)
    const reminded = ms(settings.last_reminded_at)
    const snoozeAt = ms(settings.snooze_until)
    const snoozedAt = ms(settings.snoozed_at)
    engine.configure({
      enabled: settings.notifications_enabled,
      intervalMinutes: settings.interval_minutes,
      window: { wake, sleep },
      soundEnabled: settings.sound_enabled,
      lastLogAt: lastLogMs,
      totalMl: todayTotal,
      goalMl: goal,
      externalAnchorAt: Math.max(resumed ?? 0, reminded ?? 0) || null,
      externalOverride: snoozeAt && snoozedAt ? { at: snoozeAt, setAt: snoozedAt } : null,
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

  // Warm the push key/registration so a tap can subscribe instantly (required by iOS Safari).
  useEffect(() => {
    if (userId) void prefetchPush()
  }, [userId])

  /** From a tap: subscribe to push first (this may show the permission prompt), then fall back. */
  const enablePushFromTap = useCallback(async (): Promise<{ perm: PermissionState; push: PushStatus }> => {
    let s: PushStatus = pushSupported() ? 'inactive' : 'unsupported'
    if (pushSupported() && notificationPermission() !== 'denied') {
      s = await ensurePushSubscription({ interactive: true })
      setPush(s)
      pushRef.current = s
      if (s === 'error') {
        toast.error('Background push couldn’t be enabled', {
          description: lastPushError() ?? 'Unknown error — in-app reminders still work.',
          duration: 12000,
        })
      }
    }
    let p = notificationPermission()
    if (p === 'default') p = await requestNotificationPermission()
    setPermission(p)
    return { perm: p, push: s }
  }, [])

  // (Re)register this device for background push whenever reminders are on and allowed.
  const enabled = settings?.notifications_enabled ?? false
  useEffect(() => {
    if (!userId || !enabled || permission !== 'granted') return
    let cancelled = false
    void ensurePushSubscription().then((s) => !cancelled && setPush(s))
    return () => {
      cancelled = true
    }
  }, [userId, enabled, permission])

  // Messages from the service worker.
  const addWaterRef = useRef(addWater)
  addWaterRef.current = addWater
  const reloadRef = useRef(reload)
  reloadRef.current = reload
  const updateSettingsRef = useRef(updateSettings)
  updateSettingsRef.current = updateSettings
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; amount?: number; minutes?: number; title?: string; body?: string; action?: string } | null
      if (!data?.type) return
      if (data.type === 'reminder-pushed') {
        // A server push arrived while the app is open: sync state and give in-app feedback.
        void reloadRef.current()
        if (document.visibilityState === 'visible') {
          toast(data.title ?? 'Time to hydrate 💧', { description: data.body, duration: 10_000 })
          if (soundRef.current) void playChime()
        }
      } else if (data.type === 'synced') {
        void reloadRef.current()
        toast.success(data.action === 'snooze-10' ? 'Snoozed for 10 minutes' : 'Logged 250 ml from notification')
      } else if (data.type === 'log-water' && typeof data.amount === 'number') {
        void addWaterRef.current(data.amount).then((ok) => ok && toast.success(`Logged ${data.amount} ml from notification`))
      } else if (data.type === 'snooze' && typeof data.minutes === 'number') {
        engineRef.current?.snooze(data.minutes)
        const now = new Date()
        void updateSettingsRef.current({
          snooze_until: new Date(now.getTime() + data.minutes * 60_000).toISOString(),
          snoozed_at: now.toISOString(),
        })
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
    const { perm: p, push: pushState } = await enablePushFromTap()
    if (p === 'denied') {
      toast.warning('Notifications are blocked', {
        description: 'Reminders will appear inside Hydrate while it is open. Allow notifications in your browser’s site settings for system alerts.',
        duration: 9000,
      })
    } else if (p === 'needs-install') {
      toast.warning('Add Hydrate to your Home Screen for notifications', {
        description: 'On iPhone, tap Share → Add to Home Screen, then open Hydrate from that icon. In-app reminders work meanwhile.',
        duration: 10000,
      })
    } else if (p === 'unsupported') {
      toast.warning('This browser does not support notifications — in-app reminders only.')
    }
    const ok = await updateSettings({ notifications_enabled: true, resumed_at: new Date().toISOString(), snooze_until: null, snoozed_at: null })
    if (!ok) return
    if (startedKey) {
      try {
        localStorage.setItem(startedKey, '1')
      } catch {
        /* ignore */
      }
    }
    setEverStarted(true)
    toast.success(everStarted ? 'Reminders resumed' : 'Reminders started', {
      description:
        pushState === 'active'
          ? 'Background push is on — reminders arrive even when Hydrate is closed.'
          : 'Keep Hydrate open in a tab (it can be in the background).',
    })
  }, [enablePushFromTap, updateSettings, startedKey, everStarted])

  const pause = useCallback(async () => {
    const ok = await updateSettings({ notifications_enabled: false })
    if (ok) toast('Reminders paused')
  }, [updateSettings])

  const test = useCallback(async () => {
    unlockAudio()
    let p = permission
    if (pushRef.current !== 'active') p = (await enablePushFromTap()).perm
    if (pushRef.current === 'active') {
      // End-to-end: server → Apple/Google push service → this and your other devices.
      try {
        const r = await sendTestPush()
        if (r.sent > 0) {
          toast.success(`Test push sent to ${r.sent} device${r.sent === 1 ? '' : 's'}`, {
            description: 'It should appear within a few seconds — even if you close Hydrate.',
          })
        } else {
          toast.error('Push could not be delivered', { description: r.errors?.[0] ?? 'No registered devices.' })
        }
      } catch (e) {
        toast.error('Test push failed', { description: errorMessage(e) })
      }
      return
    }
    const res = await engineRef.current?.test()
    if (res === 'in-app' && p !== 'granted') {
      toast.message('Showing in-app only', {
        description: p === 'needs-install' ? 'Add Hydrate to your Home Screen to get notifications.' : 'Allow notifications to get system alerts.',
      })
    }
  }, [permission, enablePushFromTap])

  const value = useMemo<ReminderCtx>(
    () => ({ snapshot, permission, push, enabled, everStarted, start, pause, test, requestPermission }),
    [snapshot, permission, push, enabled, everStarted, start, pause, test, requestPermission],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReminders() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReminders must be used within ReminderProvider')
  return v
}
