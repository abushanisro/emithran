import { readResourceLimits } from './resource-limits';

const MB = 1024 * 1024;

describe('readResourceLimits', () => {
  it('has documented defaults', () => {
    const limits = readResourceLimits({});
    expect(limits.archiveMaxExpandedBytes).toBe(256 * MB);
    expect(limits.xlsx).toEqual({ maxEntries: 5_000, maxEntryBytes: 20 * MB, maxMediaEntryBytes: 5 * MB, maxExpandedBytes: 50 * MB, maxRatio: 100 });
    expect(limits.heavyWork).toEqual({ maxConcurrent: 2, maxPerTenant: 1, workerHeapMb: 256, timeoutMs: 60_000, retryAfterSeconds: 5 });
  });

  it('follows the environment', () => {
    const limits = readResourceLimits({ ARCHIVE_MAX_EXPANDED_MB: '128', XLSX_MAX_MEDIA_ENTRY_MB: '2', HEAVY_WORK_MAX_CONCURRENT: '4', HTTP_MAX_HEADERS_COUNT: '60' });
    expect(limits.archiveMaxExpandedBytes).toBe(128 * MB);
    expect(limits.xlsx.maxMediaEntryBytes).toBe(2 * MB);
    expect(limits.heavyWork.maxConcurrent).toBe(4);
    expect(limits.http.maxHeadersCount).toBe(60);
  });

  it.each(['abc', '0', '-1', '1.5', '999999'])('refuses ARCHIVE_MAX_EXPANDED_MB=%s at boot instead of disabling the limit', (bad) => {
    expect(() => readResourceLimits({ ARCHIVE_MAX_EXPANDED_MB: bad })).toThrow(/ARCHIVE_MAX_EXPANDED_MB/);
  });

  it('refuses a header deadline longer than the request deadline', () => {
    expect(() => readResourceLimits({ HTTP_HEADERS_TIMEOUT_MS: '60000', HTTP_REQUEST_TIMEOUT_MS: '30000' })).toThrow(/HTTP_HEADERS_TIMEOUT_MS/);
  });
});
