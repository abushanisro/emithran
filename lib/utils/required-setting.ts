/**
 * A URL-style setting that has a localhost default for development only.
 *
 * Outside production a missing value falls back to `devDefault` (the local
 * docker-compose address). In production a missing value is a deployment
 * error: this throws, naming the variable, instead of silently pointing the
 * app at localhost.
 *
 * Pass the value itself (e.g. `process.env.NEXT_PUBLIC_API_URL`), not the
 * name: Next.js only inlines NEXT_PUBLIC_* variables written out literally.
 */
export function settingWithDevDefault(
  value: string | undefined,
  name: string,
  devDefault: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string {
  if (value !== undefined && value.trim() !== '') return value;
  if (nodeEnv !== 'production') return devDefault;
  throw new Error(`${name} is not set. It is required in production (no localhost default).`);
}

/** A setting that has no default in any environment. */
export function requiredSetting(value: string | undefined, name: string): string {
  if (value !== undefined && value.trim() !== '') return value;
  throw new Error(`${name} is not set.`);
}
