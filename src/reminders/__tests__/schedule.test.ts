import { describe, expect, it } from 'vitest'
import { computeNextReminder, decide, isWithinWakingHours, nextWakingInstant, type ScheduleState } from '../schedule'
import { computeStreaks } from '../../hooks/useHistory'

const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m, 0, 0).getTime()
const W = { wake: 7 * 60, sleep: 22 * 60 + 30 } // 07:00–22:30
const NIGHT = { wake: 20 * 60, sleep: 8 * 60 } // night shift 20:00–08:00
const state = (anchorAt: number, extra: Partial<ScheduleState> = {}): ScheduleState => ({
  anchorAt,
  lastFiredAt: null,
  overrideAt: null,
  overrideSetAt: null,
  ...extra,
})

describe('waking window', () => {
  it('normal window', () => {
    expect(isWithinWakingHours(at(6, 59), W)).toBe(false)
    expect(isWithinWakingHours(at(7), W)).toBe(true)
    expect(isWithinWakingHours(at(22, 29), W)).toBe(true)
    expect(isWithinWakingHours(at(22, 30), W)).toBe(false)
  })
  it('overnight window', () => {
    expect(isWithinWakingHours(at(23), NIGHT)).toBe(true)
    expect(isWithinWakingHours(at(3), NIGHT)).toBe(true)
    expect(isWithinWakingHours(at(12), NIGHT)).toBe(false)
  })
  it('next waking instant', () => {
    expect(nextWakingInstant(at(23), W)).toBe(at(7, 0, 14))
    expect(nextWakingInstant(at(5), W)).toBe(at(7))
    expect(nextWakingInstant(at(10), W)).toBe(at(10))
    expect(nextWakingInstant(at(12), NIGHT)).toBe(at(20))
  })
})

describe('next reminder', () => {
  it('interval after latest anchor', () => {
    expect(computeNextReminder(state(at(9)), null, 60, W)).toBe(at(10))
    // logging water pushes it back
    expect(computeNextReminder(state(at(9)), at(9, 40), 60, W)).toBe(at(10, 40))
    expect(computeNextReminder(state(at(9), { lastFiredAt: at(10) }), null, 45, W)).toBe(at(10, 45))
  })
  it('never schedules during sleep — rolls to wake time', () => {
    expect(computeNextReminder(state(at(22)), null, 60, W)).toBe(at(7, 0, 14))
  })
  it('snooze override honoured until a newer anchor', () => {
    const s = state(at(9), { lastFiredAt: at(10), overrideAt: at(10, 10), overrideSetAt: at(10, 1) })
    expect(computeNextReminder(s, null, 60, W)).toBe(at(10, 10))
    // drinking after snoozing cancels the snooze
    expect(computeNextReminder(s, at(10, 5), 60, W)).toBe(at(11, 5))
  })
})

describe('decide (missed reminders & dedupe)', () => {
  it('waits before due', () => {
    expect(decide(at(9, 30), state(at(9)), null, 60, W)).toEqual({ kind: 'wait', nextAt: at(10) })
  })
  it('fires once when due', () => {
    const d = decide(at(10, 0), state(at(9)), null, 60, W)
    expect(d.kind).toBe('fire')
  })
  it('collapses many missed slots into one catch-up', () => {
    const d = decide(at(14, 10), state(at(9)), null, 60, W)
    expect(d).toMatchObject({ kind: 'fire', missed: 5 })
  })
  it('after firing, the same slot does not fire again', () => {
    const fired = state(at(9), { lastFiredAt: at(10) })
    expect(decide(at(10, 0), fired, null, 60, W).kind).toBe('wait')
  })
  it('skips (no notification) when tab wakes up outside waking hours', () => {
    const d = decide(at(23, 30), state(at(21)), null, 60, W)
    expect(d).toEqual({ kind: 'skip', nextAt: at(7, 0, 14) })
  })
  it('morning catch-up after laptop slept overnight fires once at open', () => {
    // anchor 21:00 → next slot 22:00 (awake). Opened at 09:15 next day.
    const d = decide(at(9, 15, 14), state(at(21)), null, 60, W)
    expect(d.kind).toBe('fire')
  })
})

describe('streaks', () => {
  it('counts consecutive days, today pending does not break', () => {
    const today = new Date(2026, 10, 13, 12)
    const set = new Set(['2026-11-10', '2026-11-11', '2026-11-12'])
    expect(computeStreaks(set, today)).toEqual({ current: 3, best: 3 })
    set.add('2026-11-13')
    expect(computeStreaks(set, today).current).toBe(4)
    expect(computeStreaks(new Set(['2026-11-01', '2026-11-02', '2026-11-11']), today)).toEqual({ current: 0, best: 2 })
  })
})
