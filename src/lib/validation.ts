import { REMINDER_INTERVALS, type ReminderInterval } from '@/types/database'
import { parseTimeOfDay } from './time'

export const LIMITS = {
  amountMin: 1,
  amountMax: 5000,
  goalMin: 500,
  goalMax: 10000,
  nameMax: 120,
  passwordMin: 8,
} as const

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export function validateAmount(raw: string | number): Result<number> {
  const s = String(raw).trim()
  if (!s) return { ok: false, error: 'Enter an amount in ml.' }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Use whole millilitres only.' }
  const n = Number(s)
  if (n < LIMITS.amountMin) return { ok: false, error: 'Amount must be at least 1 ml.' }
  if (n > LIMITS.amountMax) return { ok: false, error: `That's a lot — max ${LIMITS.amountMax} ml per entry.` }
  return { ok: true, value: n }
}

export function validateGoal(raw: string | number): Result<number> {
  const s = String(raw).trim()
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Goal must be a whole number of ml.' }
  const n = Number(s)
  if (n < LIMITS.goalMin || n > LIMITS.goalMax)
    return { ok: false, error: `Goal must be between ${LIMITS.goalMin} and ${LIMITS.goalMax} ml.` }
  return { ok: true, value: n }
}

export function validateEmail(raw: string): Result<string> {
  const s = raw.trim()
  if (!s) return { ok: false, error: 'Email is required.' }
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { ok: false, error: 'Enter a valid email address.' }
  return { ok: true, value: s }
}

export function validatePassword(raw: string, forSignup: boolean): Result<string> {
  if (!raw) return { ok: false, error: 'Password is required.' }
  if (forSignup) {
    if (raw.length < LIMITS.passwordMin) return { ok: false, error: `Use at least ${LIMITS.passwordMin} characters.` }
    if (raw.length > 72) return { ok: false, error: 'Password is too long (max 72 characters).' }
  }
  return { ok: true, value: raw }
}

export function validateName(raw: string): Result<string> {
  const s = raw.trim()
  if (!s) return { ok: false, error: 'Tell us your name.' }
  if (s.length > LIMITS.nameMax) return { ok: false, error: 'Name is too long.' }
  return { ok: true, value: s }
}

export function validateInterval(n: number): n is ReminderInterval {
  return (REMINDER_INTERVALS as number[]).includes(n)
}

export function validateWakeSleep(wake: string, sleep: string): Result<{ wake: string; sleep: string }> {
  const w = parseTimeOfDay(wake)
  const s = parseTimeOfDay(sleep)
  if (w == null || s == null) return { ok: false, error: 'Enter valid times.' }
  if (w === s) return { ok: false, error: 'Wake and sleep times must differ.' }
  return { ok: true, value: { wake, sleep } }
}
