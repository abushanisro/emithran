import { PlasticReferenceService } from '../../../../../modules/bom-items/costing/plastic-molding/lookup/plastic-reference.service';
import { canonicalReferenceRows, type CanonicalReferenceRows } from '../../../../../modules/bom-items/costing/plastic-molding/plastic-reference';
import { fingerprintRows } from '../../../../../modules/bom-items/costing/plastic-molding/reference-fingerprint';

const rows: CanonicalReferenceRows = canonicalReferenceRows({ variables: [{ key: 'b', value: 2 }, { key: 'a', value: 1 }], lookups: { t: [{ x: 1 }] } });
const fingerprint = fingerprintRows(rows);

function build(result: { error?: { message: string } | null; data?: unknown } = {}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  const builder: Record<string, (...a: unknown[]) => unknown> = {};
  const client = {
    from: (table: string) => {
      builder['upsert'] = (...args) => { calls.push({ table, op: 'upsert', args }); return Promise.resolve({ error: result.error ?? null }); };
      builder['select'] = (...args) => { calls.push({ table, op: 'select', args }); return builder; };
      builder['eq'] = (...args) => { calls.push({ table, op: 'eq', args }); return builder; };
      builder['maybeSingle'] = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      return builder;
    },
  };
  const reasons: string[] = [];
  const database = { getPrivilegedClient: (reason: string) => { reasons.push(reason); return client; } };
  const svc = new PlasticReferenceService(database as never);
  (svc as unknown as { rowsByFingerprint: Map<string, CanonicalReferenceRows> }).rowsByFingerprint.set(fingerprint, rows); // what getReference records when it resolves
  return { svc, calls, reasons, client };
}

describe('reference snapshot store', () => {
  it('stores the canonical rows under their fingerprint once: an upsert that ignores a duplicate (content-addressed, never overwritten)', async () => {
    const { svc, calls, reasons } = build();
    await svc.persistSnapshot(fingerprint);
    expect(calls).toEqual([{ table: 'reference_data_snapshots', op: 'upsert', args: [{ fingerprint, source_version: '2026-Plastic', rows }, { onConflict: 'fingerprint', ignoreDuplicates: true }] }]);
    expect(reasons[0]).toContain('reference_data_snapshots');
  });

  it('refuses to store rows this process never loaded: it cannot vouch for them', async () => {
    const { svc } = build();
    await expect(svc.persistSnapshot('0123456789abcdef')).rejects.toThrow('not loaded in this process');
  });

  it('a failed write is an error, not a silent skip (a calculation that claims to be reproducible and is not is worse than one not saved)', async () => {
    const { svc } = build({ error: { message: 'permission denied' } });
    await expect(svc.persistSnapshot(fingerprint)).rejects.toThrow('permission denied');
  });

  it('reads the stored rows back by fingerprint as the caller, or null when none are stored', async () => {
    const a = build({ data: { rows } });
    expect(await a.svc.loadSnapshot((a.client as never), fingerprint)).toEqual(rows);
    expect(a.reasons).toEqual([]); // no privileged client: the caller reads under their own access
    const b = build({ data: null });
    expect(await b.svc.loadSnapshot(b.client as never, fingerprint)).toBeNull();
  });

  it('a stored copy hashes back to its key: what is read is what was fingerprinted', () => {
    expect(fingerprintRows(JSON.parse(JSON.stringify(rows)))).toBe(fingerprint);
  });
});
