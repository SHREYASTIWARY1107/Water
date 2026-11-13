import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { HydrationProvider } from '@/contexts/HydrationContext'
import { ReminderProvider } from '@/contexts/ReminderContext'
import { Toaster } from '@/components/ui/sonner'
import { AppShell, Logo } from '@/components/AppShell'
import { FullScreenLoader, ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute'

import { AuthPage } from '@/pages/AuthPage'
import { Dashboard } from '@/pages/Dashboard'
import { Reminders } from '@/pages/Reminders'
import { Settings } from '@/pages/Settings'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'

const History = lazy(() => import('@/pages/History').then((m) => ({ default: m.History })))

function SetupRequired() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="max-w-lg">
        <CardContent className="space-y-4">
          <Logo className="text-lg" />
          <h1 className="text-xl font-semibold">Connect Supabase to get started</h1>
          <p className="text-sm text-muted-foreground">
            Copy <code className="rounded bg-muted px-1.5 py-0.5">.env.example</code> to{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">.env.local</code> and set{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">VITE_SUPABASE_ANON_KEY</code>, then restart the dev server. See the
            README for full setup.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <Toaster />
      {!isSupabaseConfigured ? (
        <SetupRequired />
      ) : (
        <AuthProvider>
          {/* HashRouter works on any static host (GitHub Pages) with no rewrite rules. */}
          <HashRouter>
            <Routes>
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/signup" element={<AuthPage mode="signup" />} />
              </Route>
              <Route element={<ProtectedRoute />}>
                <Route
                  element={
                    <HydrationProvider>
                      <ReminderProvider>
                        <AppShell />
                      </ReminderProvider>
                    </HydrationProvider>
                  }
                >
                  <Route index element={<Dashboard />} />
                  <Route
                    path="history"
                    element={
                      <Suspense fallback={<FullScreenLoader />}>
                        <History />
                      </Suspense>
                    }
                  />
                  <Route path="reminders" element={<Reminders />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </HashRouter>
        </AuthProvider>
      )}
    </ThemeProvider>
  )
}
