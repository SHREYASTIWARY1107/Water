import { useId } from 'react'
import { cn } from '@/lib/utils'

/**
 * Animated water bottle. `progress` 0..1 controls the fill height; two offset
 * sine-wave layers drift horizontally for a living surface.
 */
export function WaterBottle({ progress, className }: { progress: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const p = Math.max(0, Math.min(1, progress))
  // Inner fillable area runs from y=70 (top) to y=300 (bottom).
  const top = 70
  const bottom = 300
  const level = bottom - (bottom - top) * p
  const wave = (amp: number, len: number) => {
    // Path twice the width so translateX(-50%) loops seamlessly.
    let d = `M0 ${amp}`
    for (let x = 0; x < 400; x += len) {
      d += ` q ${len / 4} ${-amp} ${len / 2} 0 t ${len / 2} 0`
    }
    return `${d} V 400 H 0 Z`
  }

  return (
    <div className={cn('relative', className)} role="img" aria-label={`Bottle ${Math.round(p * 100)}% full`}>
      <svg viewBox="0 0 160 320" className="h-full w-full overflow-visible">
        <defs>
          <clipPath id={`clip-${id}`}>
            <path d="M58 22h44v18c0 6 4 10 10 14 14 9 26 22 26 44v178c0 18-14 30-32 30H54c-18 0-32-12-32-30V98c0-22 12-35 26-44 6-4 10-8 10-14z" />
          </clipPath>
          <linearGradient id={`water-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--water-1)" />
            <stop offset="0.55" stopColor="var(--water-2)" />
            <stop offset="1" stopColor="var(--water-3)" />
          </linearGradient>
          <linearGradient id={`glass-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="white" stopOpacity="0.55" />
            <stop offset="0.25" stopColor="white" stopOpacity="0.08" />
            <stop offset="0.8" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="white" stopOpacity="0.25" />
          </linearGradient>
          <radialGradient id={`glow-${id}`} cx="0.5" cy="1" r="0.8">
            <stop offset="0" stopColor="var(--water-2)" stopOpacity="0.35" />
            <stop offset="1" stopColor="var(--water-2)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ground glow */}
        <ellipse cx="80" cy="312" rx="70" ry="10" fill={`url(#glow-${id})`} />

        {/* bottle body (empty glass) */}
        <path
          d="M58 22h44v18c0 6 4 10 10 14 14 9 26 22 26 44v178c0 18-14 30-32 30H54c-18 0-32-12-32-30V98c0-22 12-35 26-44 6-4 10-8 10-14z"
          className="fill-secondary/70 dark:fill-white/[0.04]"
        />

        <g clipPath={`url(#clip-${id})`}>
          <g style={{ transform: `translateY(${level - 8}px)`, transition: 'transform 1.1s cubic-bezier(0.22, 1, 0.36, 1)' }}>
            <g className="animate-wave-slow" style={{ opacity: 0.45, transformBox: 'fill-box' }}>
              <path d={wave(6, 80)} fill={`url(#water-${id})`} transform="translate(0 2)" />
            </g>
            <g className="animate-wave" style={{ transformBox: 'fill-box' }}>
              <path d={wave(5, 100)} fill={`url(#water-${id})`} transform="translate(0 5)" />
            </g>
          </g>
          {/* bubbles */}
          {p > 0.05 &&
            [
              [52, 0],
              [96, 1.4],
              [74, 2.6],
              [110, 3.6],
            ].map(([x, delay], i) => (
              <circle
                key={i}
                cx={x}
                cy={bottom - 6}
                r={i % 2 ? 2 : 3}
                fill="white"
                opacity="0"
                style={{ animation: `bubble-${id} 4.5s ${delay}s ease-in infinite` }}
              />
            ))}
          <rect x="0" y="0" width="160" height="320" fill={`url(#glass-${id})`} />
        </g>

        {/* cap */}
        <rect x="54" y="6" width="52" height="20" rx="7" className="fill-primary/85" />
        <rect x="54" y="20" width="52" height="4" className="fill-black/10" />

        {/* outline */}
        <path
          d="M58 22h44v18c0 6 4 10 10 14 14 9 26 22 26 44v178c0 18-14 30-32 30H54c-18 0-32-12-32-30V98c0-22 12-35 26-44 6-4 10-8 10-14z"
          fill="none"
          className="stroke-foreground/10"
          strokeWidth="2"
        />
        {/* measurement ticks */}
        {[0.25, 0.5, 0.75].map((t) => {
          const y = bottom - (bottom - top) * t
          return <line key={t} x1="124" x2="134" y1={y} y2={y} className="stroke-foreground/15" strokeWidth="2" strokeLinecap="round" />
        })}
      </svg>
      <style>{`@keyframes bubble-${id}{0%{transform:translateY(0);opacity:0}15%{opacity:.6}100%{transform:translateY(-${Math.max(30, (bottom - level) - 10)}px);opacity:0}}`}</style>
    </div>
  )
}
