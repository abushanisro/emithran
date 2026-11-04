// The 3D files of a casting analysis: the part's mesh and its cores' bodies, as the worker's result lists them (`parts[].glb`, `parts[].casting.cores_glb`).
// Only a name the result lists can be asked for, so a request cannot reach any other object of the store.

/** The mesh file names (`parts/<id>.glb`) an analysis result lists. */
export function meshNames(result: unknown): string[] {
  const parts = (result as { parts?: Array<{ glb?: unknown; casting?: { cores_glb?: unknown } | null }> } | null)?.parts;
  if (!Array.isArray(parts)) return [];
  const names = parts.flatMap((p) => [p?.glb, p?.casting?.cores_glb]).filter((n): n is string => typeof n === 'string' && /^parts\/[A-Za-z0-9._-]+\.glb$/.test(n));
  return [...new Set(names)];
}

/** The object-store key of one mesh: the analysis's folder plus the file name without its `parts/` (the runner stores each part file under it). */
export const meshKey = (outputPrefix: string, name: string): string => `${outputPrefix}/${name.replace(/^parts\//, '')}`;
