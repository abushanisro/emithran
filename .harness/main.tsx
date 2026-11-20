import '@/app/globals.css';
// Verification harness (not part of the product): the real panel and viewer, with the API answered from a worker's real output.
const fx = (name: string) => `/fx/${name}`;
const params = new URLSearchParams(location.search);
const sample = params.get('sample') ?? 'hollow-box';
const results: Record<string, unknown> = {};
const summary = { id: 'a1', bomItemId: 'item-1', status: 'succeeded', drawDirection: 'auto', workerVersion: '0.18.0', schemaVersion: 1, attempts: 1, errorCode: null, errorDetail: null, createdAt: '2026-11-05T00:00:00Z', finishedAt: '2026-11-05T00:00:03Z' };
const dfm = {
  status: 'ok',
  result: { rulesetVersion: 'test', materialType: 'Gray Iron', findings: [], passed: [], notEvaluated: [] },
  reasons: [],
};
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(location.origin, '');
  console.log('FETCH', url);
  const json = (body: unknown) => new Response(JSON.stringify({ success: true, data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
  if (!path.includes('/api/v1/')) return realFetch(input, init);
  if (path.includes('/casting-analyses?bomItemId')) return json([summary]);
  if (/\/casting-analyses\/a1\/meshes/.test(path)) {
    const name = new URL(location.origin + path).searchParams.get('name') ?? '';
    return json({ name, url: fx(`${sample}/${name}`), expiresInSeconds: 300 });
  }
  if (/\/casting-analyses\/a1$/.test(path)) return json({ ...summary, result: results[sample] });
  if (path.includes('/draw-direction')) return json({ axis: null, declaredAxis: null, reason: null, setBy: null, setAt: null, status: null, notice: null });
  if (path.includes('/sand-dfm')) return json(dfm);
  return new Response(JSON.stringify({ error: { code: 'NOT_MOCKED', message: path } }), { status: 404, headers: { 'content-type': 'application/json' } });
};

const [{ createRoot }, { QueryClient, QueryClientProvider }, { SandCastingFeaturesPanel }] = await Promise.all([
  import('react-dom/client'),
  import('@tanstack/react-query'),
  import('@/components/features/casting-viewer/SandCastingFeaturesPanel'),
]);
results[sample] = await (await realFetch(fx(`${sample}/result.json`))).json();

const gating = { sprueDiameterMm: 22, sprueHeightMm: 160, wellDiameterMm: 40, wellDepthMm: 30, runnerWidthMm: 18, runnerHeightMm: 14, runnerLengthMm: 140, ingates: 2, ingateWidthMm: 16, ingateHeightMm: 6, ingateLengthMm: 12, risers: 1, riserDiameterMm: 40, riserHeightMm: 60 };
const lines = [
  ['Melting', 2], ['Hot Box coremaking', 1.5], ['Core Refractory Coat', 0.1], ['Horizontal Automatic', 0.75], ['Mold Refractory Coat', 0.2], ['Refractory Coat Oven Dry (mould)', 0.3],
  ['Pour', 0.5], ['Cooling', 30], ['Shakeout', 0.25], ['Degating', 1], ['Cleaning', 0.5], ['Finishing', 3], ['Visual Inspection', 0.25],
].map(([process, cycleTimeMin]) => ({ process: process as string, cycleTimeMin: cycleTimeMin as number }));

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <SandCastingFeaturesPanel
      itemId="item-1"
      fallback={<div>fallback</div>}
      gating={gating}
      flask={{ lengthMm: 600, widthMm: 500, heightMm: 300 }}
      routeLines={lines}
      mouldingProcess="Horizontal Automatic"
    />
  </QueryClientProvider>,
);
(window as unknown as { __ready: boolean }).__ready = true;
