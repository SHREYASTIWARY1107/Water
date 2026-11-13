import { useEffect, useState, type FormEvent } from 'react'
import { LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { useHydration } from '@/contexts/HydrationContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme, type ThemePref } from '@/contexts/ThemeContext'
import { LIMITS, validateGoal, validateName } from '@/lib/validation'
import { errorMessage } from '@/lib/supabase'

const GOAL_PRESETS = [2000, 2500, 3000, 3500]

export function Settings() {
  const { profile, updateProfile } = useHydration()
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('2500')
  const [errors, setErrors] = useState<{ name?: string; goal?: string }>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!profile) return
    setName(profile.full_name ?? '')
    setGoal(String(profile.daily_goal_ml))
  }, [profile?.full_name, profile?.daily_goal_ml]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!profile) return null
  const dirty = name.trim() !== (profile.full_name ?? '') || goal !== String(profile.daily_goal_ml)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const n = validateName(name)
    const g = validateGoal(goal)
    const next = { name: n.ok ? undefined : n.error, goal: g.ok ? undefined : g.error }
    setErrors(next)
    if (!n.ok || !g.ok) return
    setSaving(true)
    const ok = await updateProfile({ full_name: n.value, daily_goal_ml: g.value })
    setSaving(false)
    if (ok) toast.success('Saved')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="animate-fade-up">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Personalise your goal and appearance.</p>
      </div>

      <Card>
        <form onSubmit={save} noValidate>
          <CardHeader>
            <CardTitle>Profile & goal</CardTitle>
            <CardDescription>Most adults need 2–3 L a day; more if active or in hot weather.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} maxLength={LIMITS.nameMax} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal">Daily goal (ml)</Label>
              <Input
                id="goal"
                inputMode="numeric"
                value={goal}
                onChange={(e) => setGoal(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                aria-invalid={!!errors.goal}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                {GOAL_PRESETS.map((g) => (
                  <Button key={g} type="button" variant={goal === String(g) ? 'default' : 'secondary'} size="sm" onClick={() => setGoal(String(g))}>
                    {(g / 1000).toFixed(1)} L
                  </Button>
                ))}
              </div>
              {errors.goal && <p className="text-xs text-destructive">{errors.goal}</p>}
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!dirty || saving}>
                Save changes
              </Button>
            </div>
          </CardContent>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <Segmented<ThemePref>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Signed in as <span className="font-medium text-foreground">{user?.email}</span> · Timezone {profile.timezone}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await signOut()
              } catch (e) {
                toast.error('Sign out failed', { description: errorMessage(e) })
              }
            }}
          >
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
