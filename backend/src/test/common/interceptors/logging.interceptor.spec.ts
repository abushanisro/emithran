import { accessLogLine, isProbe } from '../../../common/interceptors/logging.interceptor';

describe('HTTP access log', () => {
  it('writes one line per request: method, path, status, duration', () => {
    expect(accessLogLine('GET', '/v1/api/projects', 200, 12)).toBe('GET /v1/api/projects 200 12ms');
  });

  it('treats the uptime probes as probes, and nothing else', () => {
    expect(isProbe('/api/health')).toBe(true);
    expect(isProbe('/ping')).toBe(true);
    expect(isProbe('/v1/api/projects')).toBe(false);
    expect(isProbe('/api/health-report')).toBe(false);
  });
});
