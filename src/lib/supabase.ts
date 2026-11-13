import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// Only the public anon / publishable key belongs here. NEVER put the service-role key in a VITE_ variable.
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as
  | string
  | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

if (anonKey && looksLikeServiceRole(anonKey)) {
  throw new Error(
    'A Supabase service-role key was supplied to the frontend. Use the anon/publishable key instead and rotate the service-role key.',
  )
}

export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'hydrate-auth',
      // PKCE returns ?code= (not #tokens), which plays nicely with HashRouter.
      flowType: 'pkce',
    },
  },
)

function looksLikeServiceRole(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

/** Turn any thrown/returned Supabase error into a human message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  if (typeof err === 'string') return err
  if (err instanceof Error && err.message) {
    if (/Failed to fetch|NetworkError|Load failed/i.test(err.message)) return 'Network error — check your connection.'
    return err.message
  }
  if (typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return fallback
}
