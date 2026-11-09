/**
 * Runs once when the Next.js server starts. A wrong Auth0 setting is reported here, by name, instead of surfacing later as a redirect
 * loop to the sign-in page. Development logs it loudly and keeps running (so the "not configured" state is visible); production refuses
 * to start, as the backend does.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SKIP_ENV_VALIDATION === 'true') return;
  const { assertAuth0Config } = await import('@/lib/auth0-config');
  try {
    assertAuth0Config();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.error(`\n[auth] ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
