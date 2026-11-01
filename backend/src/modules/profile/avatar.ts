/** Profile photos, kept in the object store (S3-compatible) under one key per user. */
export const AVATAR_BUCKET = 'avatars';
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Signed links last as long as the longest session (12 h), so an open page never shows a broken photo. */
export const AVATAR_URL_TTL_SECONDS = 12 * 60 * 60;

export type AvatarType = 'image/jpeg' | 'image/png' | 'image/webp';

/** One key per user, overwritten on each upload; it is what user_profiles.avatar_url stores. */
export const avatarKey = (userId: string): string => `${userId}/avatar`;

/**
 * The image type from the file's first bytes. The browser's file name and Content-Type are not trusted, and SVG is never accepted
 * because it can carry script.
 */
export function detectAvatarType(bytes: Buffer): AvatarType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
