import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE as deleteAnnotations, GET as getAnnotations, POST as postAnnotations } from '@/app/api/balloon-annotations/route';
import { POST as extractInspectionTable } from '@/app/api/extract-inspection-table/route';

// The signed-in user is switched per test; null means no session.
let caller: string | null = null;
vi.mock('@/lib/server/auth', () => ({
  requireUser: () =>
    Promise.resolve(
      caller
        ? { ok: true, userId: caller, accessToken: 'token' }
        : { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) },
    ),
}));

const url = (path: string) => `http://localhost${path}`;
const json = (path: string, body: unknown) =>
  new NextRequest(url(path), { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const balloons = [{ id: 'b1', number: 1, x: 10, y: 20 }];

beforeEach(() => {
  caller = null;
});

describe('without a session', () => {
  it.each([
    ['GET balloon-annotations', () => getAnnotations(new NextRequest(url('/api/balloon-annotations?fileId=f1')))],
    ['POST balloon-annotations', () => postAnnotations(json('/api/balloon-annotations', { fileId: 'f1', balloons }))],
    ['DELETE balloon-annotations', () => deleteAnnotations(new NextRequest(url('/api/balloon-annotations?fileId=f1'), { method: 'DELETE' }))],
    ['POST extract-inspection-table', () => extractInspectionTable(json('/api/extract-inspection-table', { pdfBuffer: [1, 2, 3] }))],
  ])('%s is refused with 401', async (_label, call) => {
    expect((await call()).status).toBe(401);
  });
});

describe('balloon annotations are per user', () => {
  it("one user cannot read or delete another user's annotations for the same file id", async () => {
    caller = 'user-a';
    expect((await postAnnotations(json('/api/balloon-annotations', { fileId: 'shared', balloons }))).status).toBe(200);

    caller = 'user-b';
    const read = await getAnnotations(new NextRequest(url('/api/balloon-annotations?fileId=shared')));
    expect(((await read.json()) as { data: unknown }).data).toEqual([]);
    await deleteAnnotations(new NextRequest(url('/api/balloon-annotations?fileId=shared'), { method: 'DELETE' }));

    caller = 'user-a';
    const own = await getAnnotations(new NextRequest(url('/api/balloon-annotations?fileId=shared')));
    expect(((await own.json()) as { data: unknown }).data).toEqual(balloons);
  });
});
