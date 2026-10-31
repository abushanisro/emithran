import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request as PostgREST received it. */
export interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  auth: string | undefined;
  body: unknown;
}

type Reply = { status?: number; rows: unknown };

/**
 * A stand-in PostgREST on a real port: the service's own client sends real HTTP, so these tests pin the requests the API makes
 * (table, filters, token) the same way they will reach the database.
 */
export class FakePostgrest {
  readonly seen: Seen[] = [];
  private readonly replies = new Map<string, Reply[]>();
  private server!: Server;
  url = '';

  reply(method: string, path: string, rows: unknown, status = 200): this {
    const key = `${method} ${path}`;
    this.replies.set(key, [...(this.replies.get(key) ?? []), { status, rows }]);
    return this;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req).then(({ status, body }) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const url = new URL(req.url ?? '/', 'http://fake');
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const method = req.method ?? 'GET';
    this.seen.push({ method, path: url.pathname, query: url.searchParams, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });

    const queue = this.replies.get(`${method} ${url.pathname}`) ?? [];
    const next = queue.shift() ?? { status: 200, rows: [] };
    if (next.status && next.status >= 400) return { status: next.status, body: next.rows };
    // .single() / .maybeSingle() ask for one object; PostgREST answers 406 when there is not exactly one row.
    if ((req.headers.accept ?? '').includes('vnd.pgrst.object') && Array.isArray(next.rows)) {
      return next.rows.length === 1
        ? { status: 200, body: next.rows[0] }
        : { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    }
    return { status: next.status ?? 200, body: next.rows };
  }
}
