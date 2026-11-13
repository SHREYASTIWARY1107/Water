import { useEffect, useState } from 'react'
import { AlertTriangle, BellRing, CheckCircle2, CloudLightning, Info, Moon, Share, Sun, Volume2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Segmented } from '@/components/ui/segmented'
import { ReminderCard } from '@/components/ReminderCard'
import { useHydration } from '@/contexts/HydrationContext'
import { useReminders } from '@/contexts/ReminderContext'
import { REMINDER_INTERVALS, type ReminderInterval } from '@/types/database'
import { toHHMM } from '@/lib/time'
import { validateInterval, validateWakeSleep } from '@/lib/validation'
import { playChime, unlockAudio } from '@/reminders/sound'

export function Reminders() {
  const { settings, updateSettings } = useHydration()
  const { permission, requestPermission, push } = useReminders()
  const [wake, setWake] = useState('07:00')
  const [sleep, setSleep] = useState('22:30')
  const [timeError, setTimeError] = useState<string | null>(null)
  const [savingTimes, setSavingTimes] = useState(false)

  useEffect(() => {
    if (!settings) return
    setWake(toHHMM(settings.wake_time))
    setSleep(toHHMM(settings.sleep_time))
  }, [settings?.wake_time, settings?.sleep_time]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!settings) return null
  const timesDirty = wake !== toHHMM(settings.wake_time) || sleep !== toHHMM(settings.sleep_time)

  const saveTimes = async () => {
    const v = validateWakeSleep(wake, sleep)
    if (!v.ok) {
      setTimeError(v.error)
      return
    }
    setTimeError(null)
    setSavingTimes(true)
    await updateSettings({ wake_time: wake, sleep_time: sleep })
    setSavingTimes(false)
  }

  const changeInterval = (n: ReminderInterval) => {
    if (validateInterval(n)) void updateSettings({ interval_minutes: n })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="animate-fade-up">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Reminders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Gentle nudges, only while you’re awake.</p>
      </div>

      <ReminderCard />

      <Card>
        <CardHeader>
          <CardTitle>Remind me every</CardTitle>
          <CardDescription>The countdown restarts whenever you log a drink.</CardDescription>
        </CardHeader>
        <CardContent>
          <Segmented
            ariaLabel="Reminder interval"
            value={settings.interval_minutes}
            onChange={changeInterval}
            options={REMINDER_INTERVALS.map((m) => ({ value: m, label: m === 60 ? '1 hr' : m === 90 ? '1.5 hr' : `${m} min` }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waking hours</CardTitle>
          <CardDescription>You’ll never be notified outside this window. Overnight windows are supported.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="wake" className="flex items-center gap-1.5">
                <Sun className="size-3.5 text-amber-500" /> Wake up
              </Label>
              <Input id="wake" type="time" value={wake} onChange={(e) => setWake(e.target.value)} required className="min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left" />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="sleep" className="flex items-center gap-1.5">
                <Moon className="size-3.5 text-indigo-400" /> Bedtime
              </Label>
              <Input id="sleep" type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} required className="min-w-0 appearance-none text-left [&::-webkit-date-and-time-value]:text-left" />
            </div>
          </div>
          {timeError && <p className="text-xs text-destructive">{timeError}</p>}
          <div className="flex justify-end">
            <Button onClick={saveTimes} disabled={!timesDirty || savingTimes}>
              Save hours
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0 sm:p-0">
          <Row
            icon={<Volume2 className="size-4" />}
            title="Gentle sound"
            desc="A soft two-note chime with each reminder."
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    unlockAudio()
                    void playChime()
                  }}
                >
                  Preview
                </Button>
                <Switch
                  checked={settings.sound_enabled}
                  onCheckedChange={(v) => {
                    unlockAudio()
                    void updateSettings({ sound_enabled: v })
                  }}
                  aria-label="Reminder sound"
                />
              </div>
            }
          />
          <Row
            icon={<BellRing className="size-4" />}
            title="Browser notifications"
            desc={
              permission === 'granted'
                ? 'Allowed — you’ll get system notifications.'
                : permission === 'denied'
                  ? 'Blocked. Enable them in your browser’s site settings (lock icon in the address bar).'
                  : permission === 'needs-install'
                    ? 'On iPhone/iPad, notifications only work after adding Hydrate to your Home Screen (see below).'
                    : permission === 'unsupported'
                      ? 'Not supported in this browser — in-app alerts only.'
                      : 'Not yet allowed.'
            }
            action={
              permission === 'granted' ? (
                <CheckCircle2 className="size-5 text-success" />
              ) : permission === 'default' ? (
                <Button size="sm" onClick={() => void requestPermission()}>
                  Allow
                </Button>
              ) : (
                <AlertTriangle className="size-5 text-amber-500" />
              )
            }
          />
          <Row
            icon={<CloudLightning className="size-4" />}
            title="Background reminders"
            desc={
              push === 'active'
                ? 'On for this device — reminders arrive even when Hydrate is closed.'
                : push === 'unsupported'
                  ? permission === 'needs-install'
                    ? 'Add Hydrate to your Home Screen to enable.'
                    : 'Not available in this browser — keep a Hydrate tab open.'
                  : push === 'error'
                    ? 'Couldn’t register this device. Tap Start or Test to retry.'
                    : 'Turns on when you start reminders and allow notifications.'
            }
            action={
              push === 'active' ? (
                <CheckCircle2 className="size-5 text-success" />
              ) : (
                <span className="text-xs font-medium text-muted-foreground">{push === 'error' ? 'Retry' : 'Off'}</span>
              )
            }
          />
        </CardContent>
      </Card>

      {permission === 'needs-install' && <IOSInstallCard />}

      {push !== 'active' && (
        <Card className="border-primary/20 bg-accent/40">
          <CardContent className="flex gap-3 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="space-y-1.5 text-muted-foreground">
              <p className="font-medium text-foreground">Background push is off on this device</p>
              <p>
                Until background push is on, reminders are scheduled in this browser: keep a Hydrate tab open (it can be in the
                background or minimised). If your computer sleeps or the tab is frozen, you’ll get one catch-up reminder when it
                wakes — only during waking hours.
              </p>
              <p>Tip: install it as an app (browser menu → “Install Hydrate” / “Add to Dock”) so it’s always running.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function IOSInstallCard() {
  return (
    <Card className="border-primary/30">
      <CardContent className="space-y-3 text-sm">
        <p className="font-medium">Get notifications on iPhone</p>
        <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            Tap the <Share className="inline size-4 align-text-bottom text-primary" aria-label="Share" /> Share button in Safari’s toolbar.
          </li>
          <li>
            Choose <span className="font-medium text-foreground">Add to Home Screen</span>, then <span className="font-medium text-foreground">Add</span>.
          </li>
          <li>Open Hydrate from the new Home Screen icon, sign in, and tap Start → Allow.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Reminders then arrive as real notifications even when Hydrate is closed (requires iOS 16.4 or later).
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ icon, title, desc, action }: { icon: React.ReactNode; title: string; desc: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 sm:px-6">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-primary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      {action}
    </div>
  )
}
