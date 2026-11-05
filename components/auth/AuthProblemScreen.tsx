'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

export type AuthProblem = 'unavailable' | 'rejected'

/** What the person sees instead of a silent redirect to the sign-in page, which would only loop. */
export const AUTH_PROBLEMS: Record<AuthProblem, { title: string; body: string }> = {
  unavailable: {
    title: 'The server is not reachable',
    body: 'You are signed in, but the eMithran server did not answer. This page keeps trying and continues on its own once the server is back. On a local setup, start everything with npm run dev:local.',
  },
  rejected: {
    title: 'Your sign-in was not accepted',
    body: 'You signed in, but eMithran could not accept that login. Signing in again will give the same result. Sign out, then sign in with your company account. If it keeps happening, tell your administrator.',
  },
}

export function AuthProblemScreen({ problem, onRetry, onSignOut }: { problem: AuthProblem; onRetry?: (() => void) | undefined; onSignOut: () => void }) {
  const { title, body } = AUTH_PROBLEMS[problem]
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div role="alert" className="max-w-md w-full rounded-2xl border border-border bg-card p-6 space-y-4 text-center">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          {problem === 'unavailable' ? <Loader2 className="h-6 w-6 animate-spin text-primary" /> : <AlertTriangle className="h-6 w-6 text-primary" />}
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
        <div className="flex justify-center gap-2">
          {problem === 'unavailable' && onRetry && <Button onClick={onRetry}>Try again now</Button>}
          <Button variant={problem === 'unavailable' ? 'outline' : 'default'} onClick={onSignOut}>Sign out</Button>
        </div>
      </div>
    </div>
  )
}
