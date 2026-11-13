import * as React from 'react'
import { cn } from '@/lib/utils'

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'glass rounded-2xl border text-card-foreground shadow-[0_1px_2px_rgba(16,40,80,0.04),0_12px_40px_-20px_rgba(16,40,80,0.18)] dark:shadow-[0_12px_40px_-20px_rgba(0,0,0,0.6)]',
        className,
      )}
      {...props}
    />
  )
}
function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 p-5 sm:p-6 pb-0 sm:pb-0', className)} {...props} />
}
function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight', className)} {...props} />
}
function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}
function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent }
