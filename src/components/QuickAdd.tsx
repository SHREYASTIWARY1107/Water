import { useState, type FormEvent } from 'react'
import { CupSoda, GlassWater, Milk, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHydration } from '@/contexts/HydrationContext'
import { validateAmount } from '@/lib/validation'
import { cn } from '@/lib/utils'

const PRESETS = [
  { ml: 150, label: 'Cup', icon: CupSoda },
  { ml: 250, label: 'Glass', icon: GlassWater },
  { ml: 500, label: 'Bottle', icon: Milk },
]

export function QuickAdd() {
  const { addWater, undoLast, todayLogs } = useHydration()
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | 'custom' | 'undo' | null>(null)
  const [pulse, setPulse] = useState<number | null>(null)

  const add = async (ml: number) => {
    setBusy(ml)
    setPulse(ml)
    window.setTimeout(() => setPulse(null), 500)
    await addWater(ml)
    setBusy(null)
  }

  const submitCustom = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateAmount(custom)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setError(null)
    setBusy('custom')
    const ok = await addWater(v.value)
    setBusy(null)
    if (ok) setCustom('')
  }

  const undo = async () => {
    setBusy('undo')
    await undoLast()
    setBusy(null)
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Log a drink</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={busy === 'undo' || todayLogs.length === 0}
          aria-label="Undo last entry"
        >
          <Undo2 /> Undo
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {PRESETS.map(({ ml, label, icon: Icon }) => (
            <button
              key={ml}
              type="button"
              onClick={() => add(ml)}
              disabled={busy === ml}
              className={cn(
                'group relative flex cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-2xl border bg-card-solid/60 px-2 py-4 transition-all duration-200 outline-none hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--glow)] focus-visible:ring-4 focus-visible:ring-ring active:scale-95',
                pulse === ml && 'ring-4 ring-primary/25',
              )}
            >
              <span className="grid size-11 place-items-center rounded-full bg-accent text-primary transition-transform group-hover:scale-110">
                <Icon className="size-5" />
              </span>
              <span className="text-lg font-semibold tracking-tight tabular">{ml}<span className="ml-0.5 text-xs font-medium text-muted-foreground">ml</span></span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submitCustom} className="space-y-1.5" noValidate>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Custom amount"
                value={custom}
                onChange={(e) => {
                  setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 4))
                  setError(null)
                }}
                aria-label="Custom amount in millilitres"
                aria-invalid={!!error}
                className="pr-12"
              />
              <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-muted-foreground">ml</span>
            </div>
            <Button type="submit" size="icon" className="size-11" disabled={busy === 'custom' || !custom} aria-label="Add custom amount">
              <Plus className="size-5" />
            </Button>
          </div>
          {error && <p className="px-1 text-xs text-destructive">{error}</p>}
        </form>
      </CardContent>
    </Card>
  )
}
