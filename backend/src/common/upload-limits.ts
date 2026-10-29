// The one upload limit, for every layer. It comes from MAX_UPLOAD_MB (default 50, which is the Supabase free tier's cap
// on a single stored object; set 100 on a paid plan). The engine's MAX_FILE_SIZE_MB and the browser's
// NEXT_PUBLIC_MAX_UPLOAD_MB are filled from the same value in the env file, so there is nothing to keep in step by hand.
const configured = Number(process.env.MAX_UPLOAD_MB ?? 50);

export const MAX_UPLOAD_MB = Number.isFinite(configured) && configured > 0 ? configured : 50;
export const MAX_CAD_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** A zip is unpacked in memory, so what it may expand to is a multiple of the upload limit, not a fixed gigabyte. */
export const MAX_ARCHIVE_EXPANDED_BYTES = MAX_CAD_FILE_BYTES * 8;
