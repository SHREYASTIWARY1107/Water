import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Catches render errors so the app never goes blank; offers a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[hydrate] render error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(this.state.error.message)
    return (
      <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-lg font-semibold">{stale ? 'Hydrate was updated' : 'Something went wrong'}</p>
          <p className="text-sm text-muted-foreground">
            {stale ? 'A newer version is available. Reload to continue.' : 'Reload the page to continue. Your data is safe.'}
          </p>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
        </div>
      </div>
    )
  }
}
