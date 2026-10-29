// Engineer review of decoded PMI values against the REAL database (migration 908) and the real stored analysis of
// RMP-00015 (item b42dd401...): real sign-in (row-level security), the real PmiReviewService, the real
// review_pmi_record() function. No mocks. Rows this test writes are marked "e2e:" in their notes and removed
// afterwards with the service key; nothing else is touched. The analysis must have been refreshed so its records
// carry fingerprints (cad-engine geo_v59).
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import { BOMItemsModule } from '../src/modules/bom-items/bom-items.module';
import { PmiReviewService } from '../src/modules/bom-items/services/pmi-review.service';

jest.setTimeout(180_000);

const ITEM = 'b42dd401-2ceb-45e2-9781-b80c62ec7f9e';
const SLOT = 'pmi:Width2@Width1(15)';
const NATIVE = 'pmi:Radius1@Cylinder2(45.75)';
const POSITION = 'pmi:Position1@Hole Pattern2';
const NOTE = 'e2e: ';

describe('[e2e] PMI record review (migration 908)', () => {
  let service: PmiReviewService;
  let token: string;
  let userId: string;
  let anon: SupabaseClient;
  let admin: SupabaseClient;
  let userClient: SupabaseClient;

  const slot = async () => (await service.get(ITEM, userId, token)).records.find((r) => r.id === SLOT)!;
  const fingerprintOf = async (id: string, datum = false) => {
    const r = (await service.get(ITEM, userId, token)).records.find((x) => x.id === id)!;
    return (datum ? r.datumRefsFingerprint : r.fingerprint)!;
  };
  const rows = async (key: string) => (await admin.from('pmi_record_reviews').select('*').eq('bom_item_id', ITEM).eq('record_key', key).order('reviewed_at', { ascending: false })).data ?? [];
  const clean = async () => { await admin.from('pmi_record_reviews').delete().eq('bom_item_id', ITEM).like('notes', `${NOTE}%`); };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../../.env') }), BOMItemsModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const { data, error } = await anon.auth.signInWithPassword({ email: env.E2E_EMAIL!, password: env.E2E_PASSWORD! });
    if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
    token = data.session.access_token;
    userId = data.user!.id;
    userClient = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${token}` } } });
    admin = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_SERVICE_KEY'));
    service = moduleRef.get(PmiReviewService);
    await clean();
  });

  afterAll(async () => { await clean(); });

  it('the part has its records with fingerprints, the caller is an owner who may review, and nothing is approved yet', async () => {
    const view = await service.get(ITEM, userId, token);
    expect(view.records).toHaveLength(20);
    expect(view.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(view.records.every((r) => r.fingerprint)).toBe(true);
    expect(view).toMatchObject({ role: 'owner', canReview: true });
    const w = await slot();
    expect(w).toMatchObject({ reviewState: 'awaiting_review', automationReady: false });
    expect(view.records.find((r) => r.id === NATIVE)).toMatchObject({ reviewState: 'verified', automationReady: true, automationBasis: 'native_pmi' });
  });

  it('a table write that does not go through the review function is denied by the database', async () => {
    const { error } = await userClient.from('pmi_record_reviews').insert({
      bom_item_id: ITEM, organization_id: '00000000-0000-0000-0000-000000000000', record_key: SLOT, scope: 'record', decision: 'approved',
      record_fingerprint: 'x', file_sha256: 'x', reviewer_id: userId, approved_values: {}, decoded_status: 'x', provenance: {}, basis: 'other',
    });
    expect(error?.code).toBe('42501');
  });

  it('refuses callers without the owner role (service gate) and malformed requests', async () => {
    const fp = await fingerprintOf(SLOT);
    await expect(service.review(ITEM, '11111111-1111-1111-1111-111111111111', token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'engineering_drawing', notes: `${NOTE}not an owner` })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'a hunch' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'maybe' as any, recordFingerprint: fp, basis: 'other' })).rejects.toBeInstanceOf(BadRequestException);
    expect(await rows(SLOT)).toHaveLength(0);
  });

  it('refuses what cannot be reviewed: a native record, an unknown record, a stale fingerprint', async () => {
    const fp = await fingerprintOf(SLOT);
    await expect(service.review(ITEM, userId, token, { recordKey: NATIVE, decision: 'approved', recordFingerprint: await fingerprintOf(NATIVE), basis: 'other', notes: `${NOTE}native` })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.review(ITEM, userId, token, { recordKey: 'pmi:Nothing@1', decision: 'approved', recordFingerprint: fp, basis: 'other', notes: `${NOTE}unknown` })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: 'f'.repeat(64), basis: 'engineering_drawing', notes: `${NOTE}stale` })).rejects.toBeInstanceOf(ConflictException);
    expect(await rows(SLOT)).toHaveLength(0);
  });

  it('an owner approves the slot width: persisted with reviewer, time, values, file hash, provenance and basis; automation-ready for exactly this content', async () => {
    const before = await slot();
    const view = await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: before.fingerprint!, basis: 'engineering_drawing', notes: `${NOTE}checked against drawing` });
    const after = view.records.find((r) => r.id === SLOT)!;
    expect(after).toMatchObject({ reviewState: 'approved', automationReady: true, automationBasis: 'engineer_approved', source: 'decoded_graphics' });
    expect(after.limits).toEqual({ lowerMm: -0.25, upperMm: 0.25, minMm: 14.75, maxMm: 15.25 }); // provenance and values untouched

    const saved = await rows(SLOT);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      decision: 'approved', scope: 'record', reviewer_id: userId, basis: 'engineering_drawing', superseded_at: null,
      record_fingerprint: before.fingerprint, file_sha256: view.fileSha256, decoded_status: before.status,
    });
    expect(saved[0].reviewer_email).toBeTruthy();
    expect(new Date(saved[0].reviewed_at).getTime()).toBeGreaterThan(Date.now() - 120_000);
    expect(saved[0].approved_values).toMatchObject({ unit: 'mm', nominal_mm: 15, lower_mm: -0.25, upper_mm: 0.25, min_mm: 14.75, max_mm: 15.25 });
    expect(saved[0].provenance.provenance.decode.text.replace(/ /g, '')).toBe('15.00±0.25'); // the original extraction provenance
  });

  it('approving again is idempotent: no duplicate row; only one current decision exists', async () => {
    const fp = await fingerprintOf(SLOT);
    await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'engineering_drawing', notes: `${NOTE}again` });
    expect(await rows(SLOT)).toHaveLength(1);
    const current = (await rows(SLOT)).filter((r) => r.superseded_at === null);
    expect(current).toHaveLength(1);
  });

  it('a later rejection supersedes the approval and keeps the full history; the record is no longer usable', async () => {
    const fp = await fingerprintOf(SLOT);
    const view = await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'rejected', recordFingerprint: fp, basis: 'customer_specification', notes: `${NOTE}spec says otherwise` });
    expect(view.records.find((r) => r.id === SLOT)).toMatchObject({ reviewState: 'rejected', automationReady: false, automationBasis: null });
    const history = await service.history(ITEM, SLOT, token);
    expect(history.map((h) => h.decision)).toEqual(['rejected', 'approved']); // newest first
    expect(history[0]!.supersededAt).toBeNull();
    expect(history[1]!.supersededAt).not.toBeNull();
  });

  it('an approval is bound to the STEP file: it goes stale when the file hash changes, and one given against another file does not carry over', async () => {
    const fp = await fingerprintOf(SLOT);
    await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'engineering_drawing', notes: `${NOTE}for the stale check` });
    expect((await slot()).reviewState).toBe('approved');

    const original = (await admin.from('bom_items').select('feature_graph').eq('id', ITEM).single()).data!.feature_graph;
    const changed = JSON.parse(JSON.stringify(original));
    changed.pmi.source.file_sha256 = '0'.repeat(64);
    try {
      await admin.from('bom_items').update({ feature_graph: changed }).eq('id', ITEM);
      const r = await slot();
      expect(r).toMatchObject({ reviewState: 'stale', automationReady: false });
      expect(r.review?.decision).toBe('approved'); // kept for the audit view; counts for nothing
      // a decision taken now is bound to the file as it is now
      await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'other', notes: `${NOTE}against the changed file` });
      expect((await rows(SLOT)).find((x) => x.superseded_at === null)!.file_sha256).toBe('0'.repeat(64));
      expect((await slot()).reviewState).toBe('approved');
    } finally {
      await admin.from('bom_items').update({ feature_graph: original }).eq('id', ITEM);
    }
    // the real file is back: the approval given against the other file does NOT apply to it
    expect(await slot()).toMatchObject({ reviewState: 'stale', automationReady: false });
    // and re-approving against the real file works again
    await service.review(ITEM, userId, token, { recordKey: SLOT, decision: 'approved', recordFingerprint: fp, basis: 'engineering_drawing', notes: `${NOTE}re-reviewed` });
    expect(await slot()).toMatchObject({ reviewState: 'approved', automationReady: true });
  });

  it('the datum references of a native frame are a separate decision and leave its native zone untouched', async () => {
    const fp = await fingerprintOf(POSITION, true);
    const before = (await service.get(ITEM, userId, token)).records.find((r) => r.id === POSITION)!;
    expect(before).toMatchObject({ reviewState: 'verified', datumRefsReviewState: 'awaiting_review', datumRefsAutomationReady: false });
    const view = await service.review(ITEM, userId, token, { recordKey: POSITION, scope: 'datum_refs', decision: 'approved', recordFingerprint: fp, basis: 'engineering_drawing', notes: `${NOTE}datums` });
    const after = view.records.find((r) => r.id === POSITION)!;
    expect(after).toMatchObject({ reviewState: 'verified', automationBasis: 'native_pmi', datumRefsReviewState: 'approved', datumRefsAutomationReady: true });
    expect(view.records.find((r) => r.id === 'pmi:Position2@Simple Hole8')).toMatchObject({ datumRefsReviewState: 'awaiting_review' });
    const saved = (await rows(`${POSITION}#datum_refs`))[0];
    expect(saved).toMatchObject({ scope: 'datum_refs', decision: 'approved' });
    expect(saved.approved_values).toMatchObject({ datum_refs: ['A', 'B', 'C'], zone_mm: 0.15 });
    // a zone-scope request for a native frame is refused
    await expect(service.review(ITEM, userId, token, { recordKey: POSITION, decision: 'approved', recordFingerprint: await fingerprintOf(POSITION), basis: 'other', notes: `${NOTE}zone` })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a record the engine marked conflict or unresolved cannot be approved until it is fixed at the source', async () => {
    const original = (await admin.from('bom_items').select('feature_graph').eq('id', ITEM).single()).data!.feature_graph;
    const g = JSON.parse(JSON.stringify(original));
    g.pmi.records.find((r: any) => r.id === 'pmi:Width4@Width3(15.04)').validation.status = 'conflict';
    try {
      await admin.from('bom_items').update({ feature_graph: g }).eq('id', ITEM);
      const w4 = (await service.get(ITEM, userId, token)).records.find((r) => r.id === 'pmi:Width4@Width3(15.04)')!;
      expect(w4.reviewState).toBe('conflict');
      await expect(service.review(ITEM, userId, token, { recordKey: w4.id, decision: 'approved', recordFingerprint: w4.fingerprint!, basis: 'other', notes: `${NOTE}conflict` })).rejects.toBeInstanceOf(UnprocessableEntityException);
    } finally {
      await admin.from('bom_items').update({ feature_graph: original }).eq('id', ITEM);
    }
    expect(await rows('pmi:Width4@Width3(15.04)')).toHaveLength(0);
  });
});
