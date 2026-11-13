/**
 * Gentle two-note chime synthesised with Web Audio (no asset to load).
 * Browsers only allow audio after a user gesture, so `unlockAudio()` is wired
 * to the first click/keypress; after that the context can play from timers.
 */
let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

export function unlockAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

export function installAudioUnlock() {
  const handler = () => {
    unlockAudio()
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
  }
  window.addEventListener('pointerdown', handler)
  window.addEventListener('keydown', handler)
}

export async function playChime(volume = 0.18): Promise<boolean> {
  const c = getCtx()
  if (!c) return false
  try {
    if (c.state === 'suspended') await c.resume()
  } catch {
    return false
  }
  if (c.state !== 'running') return false

  const master = c.createGain()
  master.gain.value = volume
  master.connect(c.destination)

  // A soft "water drop" pair: E6 then B5, sine with a gentle bell envelope.
  const notes: [number, number][] = [
    [1318.5, 0],
    [987.8, 0.18],
  ]
  for (const [freq, offset] of notes) {
    const t0 = c.currentTime + offset
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.985, t0 + 1.2)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(1, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3)
    osc.connect(g).connect(master)
    osc.start(t0)
    osc.stop(t0 + 1.35)
  }
  return true
}
