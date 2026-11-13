import { cn } from '@/lib/utils'

/** iOS-style segmented control (shadcn-style primitive built on native radio semantics). */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
  ariaLabel: string
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('grid auto-cols-fr grid-flow-col rounded-xl bg-secondary p-1', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-9 cursor-pointer rounded-lg px-2 text-sm font-medium transition-all outline-none focus-visible:ring-4 focus-visible:ring-ring',
            o.value === value ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
