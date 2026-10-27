import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression (2026-10-27): the delivery tracking routes ran the service-role
// client with no authentication, so anyone could read any order's tracking or
// write locations into it.

const requireUser = vi.fn();
vi.mock('@/lib/server/auth', () => ({ requireUser: () => requireUser() }));

// Each table answers .select().eq().maybeSingle() / .single() with a canned row.
const adminRows: Record<string, unknown> = {};
const userRows: Record<string, unknown> = {};
const inserts: unknown[] = [];
function fakeClient(rows: Record<string, unknown>) {
  return {
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        update: () => chain,
        insert: (row: unknown) => { inserts.push(row); return chain; },
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: rows[table] ?? null, error: rows[table] ? null : { code: 'PGRST116' } }),
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return chain;
    },
  };
}
vi.mock('@/lib/database/supabase-server', () => ({
  supabaseAdmin: fakeClient(adminRows),
  createServerSupabaseClient: async () => fakeClient(userRows),
}));

const { callerCanAccessOrder } = await import('@/lib/api/delivery-tracking');
const locationRoute = await import('@/app/api/delivery/tracking/[orderId]/location/route');

const ctx = { params: Promise.resolve({ orderId: 'order-1' }) } as any;
const post = () => locationRoute.POST(
  new Request('http://x/api/delivery/tracking/order-1/location', {
    method: 'POST', body: JSON.stringify({ lat: 12.9, lng: 77.6 }),
  }) as any,
  ctx,
);

beforeEach(() => {
  for (const rows of [adminRows, userRows]) for (const k of Object.keys(rows)) delete rows[k];
  inserts.length = 0;
  requireUser.mockReset();
});

describe('delivery tracking routes', () => {
  it('refuses a caller with no session before touching the database', async () => {
    requireUser.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 401 }) });
    adminRows.delivery_orders = { project_id: 'p1' };
    expect((await post()).status).toBe(401);
    expect((await locationRoute.GET({} as any, ctx)).status).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it('reports another tenant\'s order as not found and writes nothing', async () => {
    requireUser.mockResolvedValue({ ok: true, userId: 'u1', accessToken: 't' });
    adminRows.delivery_orders = { id: 'order-1', project_id: 'p-other' };
    // projects RLS hides p-other from this caller: userRows.projects unset.
    expect((await post()).status).toBe(404);
    expect((await locationRoute.GET({} as any, ctx)).status).toBe(404);
    expect(inserts).toHaveLength(0);
  });

  it('records the event as the signed-in user when the project is visible', async () => {
    requireUser.mockResolvedValue({ ok: true, userId: 'u1', accessToken: 't' });
    adminRows.delivery_orders = { id: 'order-1', project_id: 'p1' };
    adminRows.delivery_tracking = { id: 'trk-1' };
    userRows.projects = { id: 'p1' };
    expect((await post()).status).toBe(200);
    expect(inserts).toEqual([expect.objectContaining({ delivery_order_id: 'order-1', created_by: 'u1' })]);
  });
});

describe('callerCanAccessOrder', () => {
  it('is false for an order that does not exist', async () => {
    userRows.projects = { id: 'p1' };
    expect(await callerCanAccessOrder('missing')).toBe(false);
  });
});
