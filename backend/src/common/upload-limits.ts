// The one upload limit, for every layer. It comes from MAX_UPLOAD_MB (default 50). The engine's MAX_FILE_SIZE_MB and the browser's
// NEXT_PUBLIC_MAX_UPLOAD_MB are filled from the same value in the env file, so there is nothing to keep in step by hand.
const configured = Number(process.env.MAX_UPLOAD_MB ?? 50);

export const MAX_UPLOAD_MB = Number.isFinite(configured) && configured > 0 ? configured : 50;
export const MAX_CAD_FILE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
// What an uploaded .zip may expand to is ARCHIVE_MAX_EXPANDED_MB, in common/resource-limits.ts with the other parse limits.
