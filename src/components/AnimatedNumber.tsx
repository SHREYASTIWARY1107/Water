import { useEffect, useRef, useState } from 'react'

/** Smoothly tweens a number when it changes. */
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString() }: { value: number; format?: (n: number) => string }) {
  const [display, setDisplay] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    const b = value
    if (a === b) return
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700)
      const eased = 1 - Math.pow(1 - k, 3)
      setDisplay(a + (b - a) * eased)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = b
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      from.current = b
    }
  }, [value])
  return <span className="tabular">{format(display)}</span>
}
