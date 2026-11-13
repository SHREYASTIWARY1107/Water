import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, Bell, Droplets, LogOut, Monitor, Moon, Settings, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme, type ThemePref } from '@/contexts/ThemeContext'
import { useHydration } from '@/contexts/HydrationContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Today', icon: Droplets, end: true },
  { to: '/history', label: 'History', icon: BarChart3 },
  { to: '/reminders', label: 'Reminders', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-b from-[var(--water-1)] to-[var(--water-3)] text-white shadow-[0_6px_16px_-6px_var(--water-3)]">
        <Droplets className="size-4.5" />
      </span>
      Hydrate
    </span>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const order: ThemePref[] = ['system', 'light', 'dark']
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(order[(order.indexOf(theme) + 1) % order.length])}
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
    >
      <Icon />
    </Button>
  )
}

export function AppShell() {
  const { signOut } = useAuth()
  const { status, loadError, reload } = useHydration()

  const logout = async () => {
    try {
      await signOut()
    } catch (e) {
      toast.error('Sign out failed', { description: errorMessage(e) })
    }
  }

  return (
    <div className="min-h-dvh pb-28 sm:pb-12">
      <header className="glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 rounded-full bg-secondary/70 p-1 sm:flex" aria-label="Main">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                    isActive ? 'bg-card-solid text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Sign out" title="Sign out">
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-10">
        {status === 'loading' ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
            <Skeleton className="h-[26rem] rounded-2xl" />
            <div className="space-y-5">
              <Skeleton className="h-32 rounded-2xl" />
              <Skeleton className="h-56 rounded-2xl" />
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <p className="text-lg font-semibold">We couldn’t load your data</p>
            <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
            <Button className="mt-6" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      {/* iOS-style bottom tab bar on mobile */}
      <nav
        className="glass fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label="Main mobile"
      >
        <div className="grid grid-cols-4">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
