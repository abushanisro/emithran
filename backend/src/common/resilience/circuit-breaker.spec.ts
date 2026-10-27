import { CircuitBreaker, CircuitOpenError, isServiceUnavailable } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let clock = 0;
  const now = () => clock;
  const make = () => new CircuitBreaker('engine', { failureThreshold: 3, openMs: 1000, now });
  const down = () => Promise.reject(new Error('ECONNREFUSED'));
  const up = () => Promise.resolve('ok');

  beforeEach(() => {
    clock = 0;
  });

  it('opens after the threshold of consecutive failures and then fails fast without calling the service', async () => {
    const breaker = make();
    for (let i = 0; i < 3; i++) await expect(breaker.exec(down)).rejects.toThrow('ECONNREFUSED');
    const work = jest.fn(up);
    await expect(breaker.exec(work)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(work).not.toHaveBeenCalled();
    expect(breaker.snapshot().state).toBe('open');
  });

  it('a success resets the count, so only consecutive failures open it', async () => {
    const breaker = make();
    await expect(breaker.exec(down)).rejects.toThrow();
    await expect(breaker.exec(down)).rejects.toThrow();
    await expect(breaker.exec(up)).resolves.toBe('ok');
    await expect(breaker.exec(down)).rejects.toThrow();
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('lets one trial through after openMs: success closes it, failure opens it again', async () => {
    const breaker = make();
    for (let i = 0; i < 3; i++) await expect(breaker.exec(down)).rejects.toThrow();
    clock = 1000;
    expect(breaker.snapshot().state).toBe('half_open');
    await expect(breaker.exec(down)).rejects.toThrow('ECONNREFUSED');
    expect(breaker.snapshot().state).toBe('open');
    clock = 2000;
    await expect(breaker.exec(up)).resolves.toBe('ok');
    expect(breaker.snapshot()).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
  });

  it('does not count errors the caller says are not outages (the service answered 4xx)', async () => {
    const breaker = make();
    const rejected = () => Promise.reject(Object.assign(new Error('bad file'), { response: { status: 422 } }));
    for (let i = 0; i < 5; i++) await expect(breaker.exec(rejected, isServiceUnavailable)).rejects.toThrow('bad file');
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('classifies outages: no response or 5xx is an outage, 4xx is not', () => {
    expect(isServiceUnavailable(new TypeError('fetch failed'))).toBe(true);
    expect(isServiceUnavailable({ response: { status: 503 } })).toBe(true);
    expect(isServiceUnavailable({ response: { status: 404 } })).toBe(false);
    expect(isServiceUnavailable(new CircuitOpenError('x', 1))).toBe(false);
  });
});
