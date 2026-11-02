import * as http from 'node:http';
import * as net from 'node:net';


import { readResourceLimits } from '../resource-limits';
import { applyServerLimits } from './server-limits';

import type { AddressInfo } from 'node:net';

const DEFAULTS = readResourceLimits({}).http;

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

describe('applyServerLimits', () => {
  it('sets every limit on the server, with documented defaults that tighten Node\'s own', () => {
    const server = http.createServer();
    applyServerLimits(server, DEFAULTS);
    expect([server.requestTimeout, server.headersTimeout, server.keepAliveTimeout, server.maxHeadersCount]).toEqual([300_000, 20_000, 5_000, 100]);
    expect(server.maxHeadersCount).toBeLessThan(http.createServer().maxHeadersCount ?? 2000);
    expect(server.headersTimeout).toBeLessThan(http.createServer().headersTimeout);
  });

  it('reads no more headers than the limit allows', async () => {
    const server = http.createServer((req, res) => res.end(String(req.rawHeaders.length / 2)));
    applyServerLimits(server, { ...DEFAULTS, maxHeadersCount: 20 });
    const port = await listen(server);
    try {
      const headers = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`x-h${i}`, 'v']));
      const seen = await fetch(`http://127.0.0.1:${port}/`, { headers }).then((r) => r.text());
      expect(Number(seen)).toBeLessThanOrEqual(20);
    } finally {
      server.close();
    }
  });

  it('closes a connection whose headers never finish (slowloris)', async () => {
    // Node checks deadlines every connectionsCheckingInterval; a short one keeps the test fast.
    const server = http.createServer({ connectionsCheckingInterval: 50 }, (_req, res) => res.end('ok'));
    applyServerLimits(server, { ...DEFAULTS, headersTimeoutMs: 1_000, requestTimeoutMs: 2_000 });
    const port = await listen(server);
    try {
      const started = Date.now();
      const answer = await new Promise<string>((resolve) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: x\r\nX-Slow: '));
        let data = '';
        socket.on('data', (chunk) => (data += chunk.toString()));
        socket.on('close', () => { resolve(data); });
      });
      expect(answer).toMatch(/^HTTP\/1\.1 408/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      server.close();
    }
  });
});
