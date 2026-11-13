import { Droplet, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { useHydration } from '@/contexts/HydrationContext'
import { formatClock } from '@/lib/time'
import { cn } from '@/lib/utils'

export function Timeline() {
  const { todayLogs, deleteLog } = useHydration()
  const items = [...todayLogs].reverse()

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Today’s timeline</CardTitle>
        <CardDescription>
          {todayLogs.length === 0 ? 'No drinks logged yet' : `${todayLogs.length} ${todayLogs.length === 1 ? 'drink' : 'drinks'} today`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-8 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
              <Droplet className="size-5" />
            </span>
            <p className="max-w-56 text-sm text-muted-foreground">Your first sip of the day will appear here.</p>
          </div>
        ) : (
          <ol className="relative max-h-[22rem] space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            <span aria-hidden className="absolute top-3 bottom-3 left-[19px] w-px bg-border" />
            {items.map((l, i) => {
              const pending = l.id.startsWith('temp-')
              return (
                <li
                  key={l.id}
                  className={cn(
                    'group relative flex items-center gap-3 rounded-xl py-2 pr-2 pl-0 transition-colors hover:bg-muted/60',
                    i === 0 && 'animate-fade-up',
                    pending && 'opacity-60',
                  )}
                >
                  <span className="relative z-10 grid size-10 shrink-0 place-items-center rounded-full border bg-card-solid text-primary">
                    <Droplet className="size-4" fill="currentColor" fillOpacity={Math.min(1, l.amount_ml / 500)} />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium tabular">{l.amount_ml} ml</p>
                    <p className="text-xs text-muted-foreground tabular">{formatClock(new Date(l.logged_at))}</p>
                  </div>
                  {!pending && (
                    <button
                      type="button"
                      onClick={() => deleteLog(l.id)}
                      className="grid size-8 cursor-pointer place-items-center rounded-full text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 max-sm:opacity-60"
                      aria-label={`Delete ${l.amount_ml} ml entry`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
