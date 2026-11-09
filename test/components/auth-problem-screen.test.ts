import { describe, expect, it } from 'vitest'

import { AUTH_PROBLEMS } from '@/components/auth/AuthProblemScreen'

describe('auth problem screens', () => {
  it('say what happened and what to do, for an unreachable server and a rejected login', () => {
    expect(AUTH_PROBLEMS.unavailable.title).toMatch(/not reachable/)
    expect(AUTH_PROBLEMS.unavailable.body).toMatch(/dev:local/)
    expect(AUTH_PROBLEMS.rejected.body).toMatch(/Sign out/)
  })
})
