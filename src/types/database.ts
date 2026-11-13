// Hand-written to match supabase/migrations/*_init_hydrate.sql.
// Regenerate with: npx supabase gen types typescript --project-id <id> > src/types/database.ts

export type ReminderInterval = 30 | 45 | 60 | 90
export const REMINDER_INTERVALS: ReminderInterval[] = [30, 45, 60, 90]

export type Profile = {
  id: string
  full_name: string | null
  daily_goal_ml: number
  timezone: string
  created_at: string
  updated_at: string
}

export type HydrationLog = {
  id: string
  user_id: string
  amount_ml: number
  logged_at: string
  timezone: string
  created_at: string
}

export type ReminderSettings = {
  id: string
  user_id: string
  interval_minutes: ReminderInterval
  /** "HH:MM" or "HH:MM:SS" */
  wake_time: string
  sleep_time: string
  notifications_enabled: boolean
  sound_enabled: boolean
  created_at: string
  updated_at: string
}

export type DailySummary = {
  id: string
  user_id: string
  summary_date: string // YYYY-MM-DD
  total_ml: number
  goal_ml: number
  goal_completed: boolean
  entry_count: number
  updated_at: string
}

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Pick<Profile, 'id'> & Partial<Omit<Profile, 'id'>>>
      hydration_logs: Table<
        HydrationLog,
        Pick<HydrationLog, 'amount_ml'> & Partial<Omit<HydrationLog, 'amount_ml'>>
      >
      reminder_settings: Table<ReminderSettings, Partial<ReminderSettings>>
      daily_summaries: Table<DailySummary, Partial<DailySummary>>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
