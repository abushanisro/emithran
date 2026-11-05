// A table that is not in the database the API is talking to. PostgREST answers PGRST205 ("Could not find the table 'public.x' in the schema
// cache"); direct Postgres answers 42P01. It means that database predates the table (or was built from a baseline without it), not that the request
// is wrong: callers that can do their work without an optional or retired table use this to carry on, and say so.
const CODES = new Set(['PGRST205', '42P01']);

export function isMissingTable(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return CODES.has(error.code ?? '') || /could not find the table .+ in the schema cache/i.test(error.message ?? '');
}
