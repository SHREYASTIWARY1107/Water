/**
 * Client-side reminder engine (MVP).
 *
 * Reliability measures:
 *  - Ticks from a dedicated Web Worker (exempt from Chrome's intensive
 *    background-tab timer throttling) plus a precise main-thread timeout.
 *  - Re-evaluates on visibilitychange / focus / pageshow / online so a tab
 *    that was frozen or a laptop that slept catches up immediately.
 *  - Missed slots collapse into ONE catch-up reminder, and only if it's
 *    currently waking hours. Never notifies outside waking hours.
 *  - Duplicate prevention across tabs: state lives in localStorage and the
 *    fire decision runs inside a Web Lock, so only one tab fires per slot.
 *    Notifications also share a tag so the OS replaces rather than stacks.
 *
 * Limitation: the page must stay open (any tab, can be in background).
 * For closed-browser delivery, add a WebPushChannel + server scheduler that
 * reuses ./schedule.ts — the engine talks only to the ReminderChannel interface.
 */
import {
  computeNextReminder,
  currentWindowEnd,
  decide,
  isWithinWakingHours,
  type ScheduleState,
  type WakingWindow,
} from './schedule'
import { type ReminderChannel, type ReminderPayload } from './channels'
import { playChime } from './sound'

export interface EngineConfig {
  enabled: boolean
  intervalMinutes: number
  window: WakingWindow
  soundEnabled: boolean
  lastLogAt: number | null
  totalMl: number
  goalMl: number
}

export type EngineStatus = 'off' | 'active' | 'resting'

export interface EngineSnapshot {
  status: EngineStatus
  nextAt: number | null
  lastFiredAt: number | null
  /** While active: when today's waking window closes. */
  windowEndsAt: number | null
}

type Listener = (s: EngineSnapshot) => void

const TAG = 'hydrate-reminder'
const WORKER_TICK_MS = 5_000

const MESSAGES = [
  'Time for a glass of water 💧',
  'A few sips now keeps the headache away.',
  'Your body is ~60% water — top it up.',
  'Hydration break! Stretch and sip.',
  'Small sips, big difference. Drink up.',
]

export class ReminderEngine {
  private config: EngineConfig | null = null
  private prevEnabled: boolean | undefined
  private listeners = new Set<Listener>()
  private worker: Worker | null = null
  private fallbackInterval: number | null = null
  private preciseTimer: number | null = null
  private evaluating = false
  private evalQueued = false
  private destroyed = false
  private snapshot: EngineSnapshot = { status: 'off', nextAt: null, lastFiredAt: null, windowEndsAt: null }
  private readonly storageKey: string
  private readonly lockName: string
  private readonly channel: ReminderChannel

  constructor(userId: string, channel: ReminderChannel) {
    this.channel = channel
    this.storageKey = `hydrate:reminder-state:${userId}`
    this.lockName = `hydrate-reminder-${userId}`
    this.startTicker()
    document.addEventListener('visibilitychange', this.onWake)
    window.addEventListener('focus', this.onWake)
    window.addEventListener('pageshow', this.onWake)
    window.addEventListener('online', this.onWake)
    window.addEventListener('storage', this.onStorage)
  }

  destroy() {
    this.destroyed = true
    this.worker?.terminate()
    if (this.fallbackInterval) clearInterval(this.fallbackInterval)
    if (this.preciseTimer) clearTimeout(this.preciseTimer)
    document.removeEventListener('visibilitychange', this.onWake)
    window.removeEventListener('focus', this.onWake)
    window.removeEventListener('pageshow', this.onWake)
    window.removeEventListener('online', this.onWake)
    window.removeEventListener('storage', this.onStorage)
    this.listeners.clear()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    fn(this.snapshot)
    return () => this.listeners.delete(fn)
  }

  getSnapshot() {
    return this.snapshot
  }

  configure(next: EngineConfig) {
    const wasEnabled = this.prevEnabled
    this.config = next
    this.prevEnabled = next.enabled

    const stored = this.readState()
    if (next.enabled && (wasEnabled === false || !stored)) {
      // Started / resumed: the countdown begins now.
      this.writeState({ anchorAt: Date.now(), lastFiredAt: stored?.lastFiredAt ?? null, overrideAt: null, overrideSetAt: null })
    }
    void this.evaluate()
  }

  /** Push the next reminder `minutes` from now (used by the notification's Snooze action). */
  snooze(minutes: number) {
    const s = this.readState() ?? this.freshState()
    const now = Date.now()
    this.writeState({ ...s, overrideAt: now + minutes * 60_000, overrideSetAt: now })
    void this.evaluate()
  }

  /** Fire a test notification right now (doesn't affect the schedule). */
  async test(): Promise<string> {
    const sound = this.config?.soundEnabled ?? true
    const chimed = sound ? await playChime() : false
    return this.channel.deliver({
      title: 'Hydrate test 💧',
      body: 'Notifications are working. You will be reminded like this.',
      tag: `${TAG}-test`,
      silent: chimed || !sound,
    })
  }

  // ---------------------------------------------------------------------------

  private onWake = () => {
    void this.evaluate()
  }

  private onStorage = (e: StorageEvent) => {
    // Another tab fired/snoozed — recompute so countdowns stay in sync.
    if (e.key === this.storageKey) void this.evaluate()
  }

  private startTicker() {
    try {
      const src = `let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}`
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
      this.worker = new Worker(url)
      URL.revokeObjectURL(url)
      this.worker.onmessage = () => void this.evaluate()
      this.worker.postMessage(WORKER_TICK_MS)
    } catch {
      this.fallbackInterval = window.setInterval(() => void this.evaluate(), WORKER_TICK_MS)
    }
  }

  private schedulePrecise(nextAt: number | null) {
    if (this.preciseTimer) clearTimeout(this.preciseTimer)
    this.preciseTimer = null
    if (nextAt == null) return
    const delay = Math.min(Math.max(nextAt - Date.now(), 0) + 50, 2 ** 31 - 1)
    this.preciseTimer = window.setTimeout(() => void this.evaluate(), delay)
  }

  private freshState(): ScheduleState {
    return { anchorAt: Date.now(), lastFiredAt: null, overrideAt: null, overrideSetAt: null }
  }

  private readState(): ScheduleState | null {
    try {
      const raw = localStorage.getItem(this.storageKey)
      if (!raw) return null
      const s = JSON.parse(raw) as ScheduleState
      if (typeof s.anchorAt !== 'number') return null
      return s
    } catch {
      return null
    }
  }

  private writeState(s: ScheduleState) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(s))
    } catch {
      /* private mode etc. — engine still works within this tab */
    }
    this.memState = s
  }
  private memState: ScheduleState | null = null

  private emit(s: EngineSnapshot) {
    this.snapshot = s
    for (const l of this.listeners) l(s)
  }

  private async withLock(fn: () => Promise<void>) {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks
    if (locks?.request) {
      await locks.request(this.lockName, async () => fn())
    } else {
      await fn()
    }
  }

  private async evaluate() {
    if (this.destroyed) return
    if (this.evaluating) {
      this.evalQueued = true
      return
    }
    const cfg = this.config
    if (!cfg) return
    if (!cfg.enabled) {
      this.schedulePrecise(null)
      this.emit({ status: 'off', nextAt: null, lastFiredAt: this.readState()?.lastFiredAt ?? null, windowEndsAt: null })
      return
    }

    this.evaluating = true
    try {
      await this.withLock(async () => {
        const state = this.readState() ?? this.memState ?? this.freshState()
        const now = Date.now()
        const d = decide(now, state, cfg.lastLogAt, cfg.intervalMinutes, cfg.window)

        if (d.kind === 'fire') {
          // Record first (inside the lock) so no other tab fires the same slot.
          this.writeState({ ...state, lastFiredAt: now, overrideAt: null, overrideSetAt: null })
          await this.deliver(d.missed, d.lateByMs, cfg)
        } else if (d.kind === 'skip') {
          this.writeState({ ...state, overrideAt: d.nextAt, overrideSetAt: now })
        }
      })
    } catch (err) {
      console.error('[hydrate] reminder evaluation failed', err)
    } finally {
      this.evaluating = false
    }
    if (this.evalQueued) {
      this.evalQueued = false
      void this.evaluate()
      return
    }

    const state = this.readState() ?? this.memState ?? this.freshState()
    const now = Date.now()
    const nextAt = computeNextReminder(state, cfg.lastLogAt, cfg.intervalMinutes, cfg.window)
    const awake = isWithinWakingHours(now, cfg.window)
    this.schedulePrecise(nextAt)
    this.emit({
      status: awake ? 'active' : 'resting',
      nextAt,
      lastFiredAt: state.lastFiredAt,
      windowEndsAt: awake ? currentWindowEnd(now, cfg.window) : null,
    })
  }

  private async deliver(missed: number, lateByMs: number, cfg: EngineConfig) {
    const remaining = Math.max(0, cfg.goalMl - cfg.totalMl)
    const progress =
      remaining === 0
        ? `Goal reached (${(cfg.totalMl / 1000).toFixed(1)} L) — keep sipping steadily.`
        : `${(cfg.totalMl / 1000).toFixed(1)} of ${(cfg.goalMl / 1000).toFixed(1)} L so far · ${remaining} ml to go.`
    const caughtUp = missed > 1 || lateByMs > 5 * 60_000
    const title = caughtUp ? 'Welcome back — time to hydrate 💧' : MESSAGES[Math.floor(Math.random() * MESSAGES.length)]
    // Prefer our gentle chime; fall back to the OS notification sound if audio is locked.
    const chimed = cfg.soundEnabled ? await playChime() : false
    const payload: ReminderPayload = {
      title,
      body: caughtUp ? `You were away for a bit. ${progress}` : progress,
      tag: TAG,
      silent: chimed || !cfg.soundEnabled,
    }
    await this.channel.deliver(payload)
  }
}
