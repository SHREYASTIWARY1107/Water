/**
 * Pure scheduling math for reminders — no timers, no DOM. Easy to unit test
 * and reusable later by a server-side Web Push scheduler.
 *
 * Model: a reminder is due `interval` minutes after the most recent "anchor"
 * (reminder fired, water logged, or reminders started/resumed). Reminders only
 * fire inside the waking window [wake, sleep). The window may wrap past
 * midnight (e.g. wake 10:00, sleep 01:00).
 */

export interface WakingWindow {
  /** minutes after local midnight */
  wake: number
  sleep: number
}

export interface ScheduleState {
  /** When reminders were started/resumed (ms epoch). */
  anchorAt: number
  /** Last time this device fired a reminder (ms). */
  lastFiredAt: number | null
  /** Explicit next time (snooze, or "skip until morning"); valid only while newer than every anchor. */
  overrideAt: number | null
  overrideSetAt: number | null
}

const MIN = 60_000

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

export function isWithinWakingHours(at: Date | number, w: WakingWindow): boolean {
  const m = minutesOfDay(typeof at === 'number' ? new Date(at) : at)
  if (w.wake < w.sleep) return m >= w.wake && m < w.sleep
  // wraps past midnight
  return m >= w.wake || m < w.sleep
}

/** The first instant >= `t` that is inside the waking window. */
export function nextWakingInstant(t: number, w: WakingWindow): number {
  if (isWithinWakingHours(t, w)) return t
  const d = new Date(t)
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(w.wake / 60), w.wake % 60, 0, 0)
  if (candidate.getTime() <= t) candidate.setDate(candidate.getDate() + 1)
  return candidate.getTime()
}

/** When the current waking window ends (only meaningful while awake). */
export function currentWindowEnd(t: number, w: WakingWindow): number {
  const d = new Date(t)
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(w.sleep / 60), w.sleep % 60, 0, 0)
  if (end.getTime() <= t) end.setDate(end.getDate() + 1)
  return end.getTime()
}

export function latestAnchor(state: ScheduleState, lastLogAt: number | null): number {
  return Math.max(state.anchorAt, state.lastFiredAt ?? 0, lastLogAt ?? 0)
}

/** Compute the next reminder instant (always inside the waking window). */
export function computeNextReminder(
  state: ScheduleState,
  lastLogAt: number | null,
  intervalMinutes: number,
  w: WakingWindow,
): number {
  const anchor = latestAnchor(state, lastLogAt)
  if (state.overrideAt != null && state.overrideSetAt != null && state.overrideSetAt >= anchor) {
    return nextWakingInstant(state.overrideAt, w)
  }
  return nextWakingInstant(anchor + intervalMinutes * MIN, w)
}

export type Decision =
  | { kind: 'wait'; nextAt: number }
  /** Fire now. `missed` > 1 means the tab was asleep and several slots were collapsed into one. */
  | { kind: 'fire'; scheduledFor: number; missed: number; lateByMs: number }
  /** A slot passed while we were outside waking hours — skip to the next morning. */
  | { kind: 'skip'; nextAt: number }

/**
 * Decide what to do at `now`. Handles tab inactivity: if the scheduled slot is in the
 * past (timers throttled, laptop asleep), we fire a single catch-up reminder if we're
 * awake, or skip silently if it's now outside waking hours. Never fires more than once.
 */
export function decide(
  now: number,
  state: ScheduleState,
  lastLogAt: number | null,
  intervalMinutes: number,
  w: WakingWindow,
): Decision {
  const nextAt = computeNextReminder(state, lastLogAt, intervalMinutes, w)
  if (now < nextAt) return { kind: 'wait', nextAt }
  if (!isWithinWakingHours(now, w)) return { kind: 'skip', nextAt: nextWakingInstant(now, w) }
  const lateByMs = now - nextAt
  const missed = 1 + Math.floor(lateByMs / (intervalMinutes * MIN))
  return { kind: 'fire', scheduledFor: nextAt, missed, lateByMs }
}
