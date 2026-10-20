import { RateLimitedDiagLogger, summarizeDiagMessage } from './start';

describe('exporter diagnostics are one short line, at most one per interval', () => {
  it('reduces a serialised Error (with its stack) to "Name: message"', () => {
    const raw = JSON.stringify({ name: 'Error', message: 'Timeout', stack: 'Error: Timeout\n    at /app/node_modules/x.ts:1:1' });
    expect(summarizeDiagMessage(raw)).toBe('Error: Timeout');
  });

  it('keeps only the first line of plain text and caps its length', () => {
    expect(summarizeDiagMessage('first\nsecond')).toBe('first');
    expect(summarizeDiagMessage('x'.repeat(1_000))).toHaveLength(200);
  });

  it('prints once, counts the rest, and reports the count on the next printed line', () => {
    let clock = 0;
    const logger = new RateLimitedDiagLogger(60_000, () => clock);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      clock = 100_000;
      for (let i = 0; i < 50; i += 1) logger.error('collector down');
      expect(warn).toHaveBeenCalledTimes(1);

      clock += 61_000;
      logger.warn('collector still down');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1][0])).toContain('+49 similar');
    } finally {
      warn.mockRestore();
    }
  });
});
