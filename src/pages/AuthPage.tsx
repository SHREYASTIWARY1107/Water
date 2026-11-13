import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/AppShell'
import { WaterBottle } from '@/components/WaterBottle'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/supabase'
import { validateEmail, validateName, validatePassword } from '@/lib/validation'

type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const isSignup = mode === 'signup'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Errors = {}
    const em = validateEmail(email)
    if (!em.ok) next.email = em.error
    const pw = validatePassword(password, isSignup)
    if (!pw.ok) next.password = pw.error
    if (isSignup) {
      const nm = validateName(name)
      if (!nm.ok) next.name = nm.error
    }
    setErrors(next)
    if (Object.keys(next).length) return

    setSubmitting(true)
    try {
      if (isSignup) {
        const { needsConfirmation } = await signUp(email, password, name)
        if (needsConfirmation) setConfirmSent(true)
        else navigate('/', { replace: true })
      } else {
        await signIn(email, password)
        navigate(from, { replace: true })
      }
    } catch (err) {
      const msg = errorMessage(err)
      setErrors({
        form: /invalid login credentials/i.test(msg)
          ? 'That email and password don’t match.'
          : /email not confirmed/i.test(msg)
            ? 'Please confirm your email first — check your inbox.'
            : /already registered/i.test(msg)
              ? 'An account with this email already exists. Try signing in.'
              : msg,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[var(--water-1)]/25 via-transparent to-[var(--water-3)]/20" />
        <Logo className="text-lg" />
        <div className="flex items-end gap-10">
          <WaterBottle progress={0.68} className="h-80 w-40 animate-fade-up" />
          <div className="max-w-sm pb-6">
            <h2 className="text-4xl font-semibold tracking-tight text-balance">Stay effortlessly hydrated.</h2>
            <p className="mt-3 text-muted-foreground">
              Gentle reminders that respect your sleep, a beautiful daily tracker, and insights that keep you on streak.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Your data is private — only you can see it.</p>
      </div>

      <div className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mb-8 lg:hidden">
            <Logo className="text-lg" />
          </div>

          {confirmSent ? (
            <Card>
              <CardContent className="space-y-4 text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-primary">
                  <MailCheck className="size-6" />
                </span>
                <h1 className="text-xl font-semibold">Check your inbox</h1>
                <p className="text-sm text-muted-foreground">
                  We sent a confirmation link to <span className="font-medium text-foreground">{email}</span>. Open it to
                  activate your account, then sign in.
                </p>
                <Button variant="secondary" className="w-full" asChild>
                  <Link to="/login">Back to sign in</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <h1 className="text-3xl font-semibold tracking-tight">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {isSignup ? 'Start building a healthier hydration habit.' : 'Sign in to continue your streak.'}
              </p>

              <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
                {isSignup && (
                  <Field label="Name" htmlFor="name" error={errors.name}>
                    <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} placeholder="Alex Rivera" />
                  </Field>
                )}
                <Field label="Email" htmlFor="email" error={errors.email}>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!errors.email}
                    placeholder="you@example.com"
                  />
                </Field>
                <Field label="Password" htmlFor="password" error={errors.password}>
                  <div className="relative">
                    <Input
                      id="password"
                      type={show ? 'text' : 'password'}
                      autoComplete={isSignup ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!errors.password}
                      placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
                      className="pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>

                {errors.form && (
                  <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {errors.form}
                  </p>
                )}

                <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                  {submitting && <Loader2 className="animate-spin" />}
                  {isSignup ? 'Create account' : 'Sign in'}
                </Button>
              </form>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {isSignup ? 'Already have an account? ' : 'New to Hydrate? '}
                <Link to={isSignup ? '/login' : '/signup'} className="font-medium text-primary hover:underline">
                  {isSignup ? 'Sign in' : 'Create an account'}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
