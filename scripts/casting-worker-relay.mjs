#!/usr/bin/env node
// The casting worker's socket on the Mac, for a backend run with `npm run start:dev` (CASTING_WORKER_SOCKET in .env).
//
// The worker runs sandboxed in the container emithran-local-casting-worker, listening on a Unix socket inside a Docker volume. A Unix
// socket cannot cross from Docker Desktop's VM to macOS, so emithran-local-casting-bridge exposes it as TCP on 127.0.0.1:47011 and this
// relay turns that back into the socket the backend dials. It holds no state: each connection is piped through and closed with its peer.
//
//   node scripts/casting-worker-relay.mjs [socket path] [tcp port]
//
// Defaults: ~/.emithran/casting-worker.sock and 47011. Run it at login so a restart of the Mac does not leave the backend's casting worker
// "unreachable" (scripts/install-casting-worker-relay.sh installs it as a LaunchAgent).
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const socketPath = process.argv[2] ?? join(homedir(), '.emithran', 'casting-worker.sock');
const port = Number(process.argv[3] ?? 47011);

mkdirSync(dirname(socketPath), { recursive: true });
// A socket file left by a relay that died (the Mac restarted) refuses every connection: remove it before listening.
rmSync(socketPath, { force: true });

const server = createServer((client) => {
  const upstream = createConnection({ host: '127.0.0.1', port });
  client.pipe(upstream).pipe(client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on('error', close);
  upstream.on('error', (e) => { console.error(`casting worker relay: 127.0.0.1:${port}: ${e.message}`); close(); });
});
server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  console.log(`casting worker relay on ${socketPath} -> 127.0.0.1:${port}`);
});
const stop = () => server.close(() => { rmSync(socketPath, { force: true }); process.exit(0); });
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
