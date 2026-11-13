import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-11 w-full rounded-xl border border-input bg-card-solid/70 px-4 text-[15px] transition-[box-shadow,border-color] outline-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'
export { Input }
