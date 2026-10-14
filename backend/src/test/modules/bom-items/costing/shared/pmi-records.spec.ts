/**
 * PMI engineering records on the canonical feature model, on the REAL records the CAD engine produced for
 * RMP-00015 (src/test/fixtures/rmp15-pmi-records.json): native values are the only ones that may drive a
 * decision; a decoded value reaches a feature flagged, and never as automation-ready.
 */
import * as fixture from '../../../../fixtures/rmp15-pmi-records.json';
import { featureInstances } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import {
  automationReadyRecords, pmiLimitsForInstance, pmiRecordsForInstance, resolvePmiRecords,
} from '../../../../../modules/bom-items/costing/shared/tolerance/pmi-records';
import { resolveGdtCallouts } from '../../../../../modules/bom-items/costing/shared/physics/gdt-callouts';

const graph = fixture as any;
const records = resolvePmiRecords(graph);
const instances = featureInstances(graph.feature_graph_v2);
const byRef = (name: string) => records.find((r) => r.annotationRef === name)!;
const instanceOfSize = (type: string, sizeMm: number) => instances.find((i) => i.featureType === type && i.sizeMm != null && Math.abs(i.sizeMm - sizeMm) < 0.01);

describe('PMI records on the canonical feature model (RMP-00015)', () => {
  it('reads all 20 records of the part with their original annotation names', () => {
    expect(records).toHaveLength(20);
    expect(new Set(records.map((r) => r.annotationRef)).size).toBe(20);
    expect(byRef('Width2@Width1(15)').id).toBe('pmi:Width2@Width1(15)');
  });

  it('the slot width carries nominal 15 and limits 14.75-15.25 from the decoded drawing, flagged for review', () => {
    const w = byRef('Width2@Width1(15)');
    expect(w.nominalMm).toBe(15);
    expect(w.limits).toEqual({ lowerMm: -0.25, upperMm: 0.25, minMm: 14.75, maxMm: 15.25 });
    expect(w.source).toBe('decoded_graphics');
    expect(w.status).toBe('decoded_cross_checked');
    expect(w.automationReady).toBe(false);
    expect(w.requiresReview).toBe(true);
  });

  it('native dimensions are verified and automation-ready; nothing decoded is', () => {
    const native = byRef('Radius1@Cylinder2(45.75)');
    expect(native).toMatchObject({ source: 'native_pmi', status: 'verified', automationReady: true, nominalMm: 45.75 });
    expect(native.limits).toEqual({ lowerMm: -0.15, upperMm: 0.15, minMm: 45.6, maxMm: 45.9 });
    for (const r of records) if (r.source !== 'native_pmi') expect(r.automationReady).toBe(false);
    expect(automationReadyRecords(records).every((r) => r.source === 'native_pmi' && r.status === 'verified')).toBe(true);
  });

  it('a frame keeps its native zone as verified and its datum references as decoded, with their source named', () => {
    const f = byRef('Position1@Hole Pattern2');
    expect(f).toMatchObject({ recordType: 'gdt', characteristic: 'position', zoneMm: 0.15, status: 'verified', automationReady: true });
    expect(f.datumRefs).toEqual(['A', 'B', 'C']);
    expect(f.datumRefsSource).toBe('decoded_graphics');
  });
});

describe('joined to feature instances by the engine faces', () => {
  it('the slot instance receives its width record only when flagged records are asked for', () => {
    const slots = instances.filter((i) => i.featureType === 'Slot');
    expect(slots).toHaveLength(2); // the 15 x 29 centre slot and a small 6 x 12 one
    const slot = slots.find((i) => i.faceIds.includes(118))!; // the centre slot: its end arcs' faces
    expect(slot).toBeDefined();
    const small = slots.find((i) => i !== slot)!;
    expect(pmiRecordsForInstance(records, small, { automationOnly: false })).toEqual([]); // the other slot gets nothing
    expect(pmiRecordsForInstance(records, slot)).toEqual([]); // automation only: the decoded value is not offered
    const flagged = pmiRecordsForInstance(records, slot, { automationOnly: false });
    expect(flagged.map((r) => r.annotationRef)).toContain('Width2@Width1(15)');
    expect(pmiLimitsForInstance(records, slot)).toBeNull();
    expect(pmiLimitsForInstance(records, slot, { automationOnly: false })).toMatchObject({ minMm: 14.75, maxMm: 15.25 });
  });

  it('a hole pattern receives its native diameter limits and its position frame', () => {
    const pattern = instanceOfSize('SimpleHole', 5.5)!;
    expect(pattern).toBeDefined();
    const got = pmiRecordsForInstance(records, pattern).map((r) => r.annotationRef);
    expect(got).toEqual(expect.arrayContaining(['Diameter4@Hole Pattern2(5.5)', 'Position1@Hole Pattern2']));
    expect(pmiLimitsForInstance(records, pattern)).toMatchObject({ minMm: 5.35, maxMm: 5.65 });
  });

  it('a feature the PMI says nothing about gets nothing', () => {
    const other = instanceOfSize('SimpleHole', 9.6)!;
    expect(other).toBeDefined();
    expect(pmiRecordsForInstance(records, other, { automationOnly: false })).toEqual([]);
  });
});

describe('safety', () => {
  const tampered = (patch: (r: any) => void) => {
    const g = JSON.parse(JSON.stringify(graph));
    patch(g.pmi.records.find((r: any) => r.annotation_ref === 'Width2@Width1(15)'));
    return resolvePmiRecords(g).find((r) => r.annotationRef === 'Width2@Width1(15)')!;
  };

  it('a producer that wrongly marks a decoded record automation-ready is not believed', () => {
    const r = tampered((raw) => { raw.validation.automation_ready = true; raw.validation.status = 'verified'; });
    expect(r.automationReady).toBe(false);
  });

  it('a native record with a conflict status is not automation-ready', () => {
    const g = JSON.parse(JSON.stringify(graph));
    const raw = g.pmi.records.find((x: any) => x.annotation_ref === 'Radius1@Cylinder2(45.75)');
    raw.validation.status = 'conflict';
    expect(resolvePmiRecords(g).find((r) => r.annotationRef === 'Radius1@Cylinder2(45.75)')!.automationReady).toBe(false);
  });

  it('malformed records are dropped, not repaired', () => {
    const g = { pmi: { records: [{ annotation_ref: 'x', record_type: 'dimension', source: 'native_pmi', validation: { status: 'maybe' } }, null, 5, { record_type: 'gdt' }] } };
    expect(resolvePmiRecords(g)).toEqual([]);
    expect(resolvePmiRecords(null)).toEqual([]);
    expect(resolvePmiRecords({ pmi: {} })).toEqual([]);
  });

  it('inconsistent limits (min above max) are discarded', () => {
    const g = JSON.parse(JSON.stringify(graph));
    g.pmi.records[0].tolerance = { lower_mm: 1, upper_mm: -1, min_mm: 10, max_mm: 5 };
    expect(resolvePmiRecords(g)[0]!.limits).toBeNull();
  });

  it('the existing GD&T resolver that costing reads is unchanged: native callouts only, records are ignored', () => {
    const callouts = resolveGdtCallouts(graph, null);
    expect(callouts.map((c) => c.type).sort()).toEqual(['cylindricity', 'flatness', 'position', 'position']);
    expect(callouts.every((c) => c.source === 'step_pmi')).toBe(true);
  });
});
