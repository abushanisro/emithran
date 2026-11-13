import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type { MachiningNeedView } from '../../services/feature-tolerance.service';
import {
  resolveMachiningAllowance,
  type AllowanceDataset,
  type AllowanceDecision,
  type AllowanceFeature,
  type AllowanceProfile,
  type MachiningAllowanceResult,
  type MouldingMethod,
} from './machining-allowance';

/**
 * The machining allowance of a cast part (machining-allowance.ts), read as the user: the part's current decisions, its organization's licensed
 * datasets and approved profiles (migration 1002). Display only: the result is shown on the cost summary and changes no cost.
 */
@Injectable()
export class MachiningAllowanceService {
  constructor(private readonly databaseService: DatabaseService) {}

  async resolve(input: {
    bomItemId: string;
    accessToken: string;
    need: MachiningNeedView;
    largestDimensionMm: number | null;
    materialFamily: string | null;
    mouldingMethod: MouldingMethod | null;
    /** The part's RMAG grade (A-K), when the engineer has set one; never inferred. */
    rmag: string | null;
  }): Promise<{ result: MachiningAllowanceResult | null; warnings: string[] }> {
    const { need } = input;
    if (!need.assessed || !need.result) return { result: null, warnings: [] };
    const client = this.databaseService.getClient(input.accessToken);

    const item = await client.from('bom_items').select('organization_id, geometry_hash').eq('id', input.bomItemId).single();
    if (item.error) return { result: null, warnings: [`Machining allowance not shown: the part could not be read (${item.error.message}).`] };
    const { organization_id: org, geometry_hash: geometryHash } = item.data as { organization_id: string; geometry_hash: string | null };

    const [decisions, datasets, profiles] = await Promise.all([
      client.from('bom_item_machining_allowances')
        .select('id, feature_key, machined, allowance_mm, sides, basis, reason, geometry_hash, set_by_email, set_at')
        .eq('bom_item_id', input.bomItemId).is('superseded_at', null),
      client.from('machining_allowance_datasets')
        .select('id, standard, edition, licence_reference, imported_at, machining_allowance_dataset_values(rmag, size_over_mm, size_upto_mm, allowance_mm)')
        .eq('organization_id', org),
      client.from('machining_allowance_profiles')
        .select('id, name, kind, version, basis, reviewed_at, machining_allowance_profile_values(material_family, moulding_method, size_over_mm, size_upto_mm, allowance_mm)')
        .eq('organization_id', org).eq('status', 'approved').order('version', { ascending: false }),
    ]);
    const failed = [decisions, datasets, profiles].find((r) => r.error);
    if (failed?.error) return { result: null, warnings: [`Machining allowance not shown: allowance data could not be read (${failed.error.message}).`] };

    const sizeOf = new Map(need.instances.map((i) => [i.key, i.sizeMm ?? null]));
    const features: AllowanceFeature[] = need.result.features
      .filter((f): f is typeof f & { featureKey: string } => f.featureKey != null)
      .map((f) => ({
        featureKey: f.featureKey, featureType: f.featureType, label: f.label, faceIds: f.faceIds, featureId: f.featureId,
        occurrenceIndex: f.occurrenceIndex, sizeMm: sizeOf.get(f.featureKey) ?? null, verdict: f.verdict,
      }));

    // The latest approved version of each profile.
    const latest = new Map<string, any>();
    for (const p of (profiles.data ?? []) as any[]) if (!latest.has(p.name)) latest.set(p.name, p);

    const result = resolveMachiningAllowance({
      features,
      geometryHash,
      largestDimensionMm: input.largestDimensionMm,
      rmag: input.rmag,
      materialFamily: input.materialFamily,
      mouldingMethod: input.mouldingMethod,
      decisions: ((decisions.data ?? []) as any[]).map((d): AllowanceDecision => ({
        id: d.id, featureKey: d.feature_key, machined: d.machined, allowanceMm: d.allowance_mm == null ? null : Number(d.allowance_mm),
        sides: d.sides, basis: d.basis, reason: d.reason, geometryHash: d.geometry_hash, setByEmail: d.set_by_email, setAt: d.set_at,
      })),
      datasets: ((datasets.data ?? []) as any[]).map((d): AllowanceDataset => ({
        id: d.id, standard: d.standard, edition: d.edition, licenceReference: d.licence_reference, importedAt: d.imported_at,
        values: (d.machining_allowance_dataset_values ?? []).map((v: any) => ({
          rmag: v.rmag, sizeOverMm: Number(v.size_over_mm), sizeUptoMm: Number(v.size_upto_mm), allowanceMm: Number(v.allowance_mm),
        })),
      })),
      profiles: [...latest.values()].map((p): AllowanceProfile => ({
        id: p.id, name: p.name, kind: p.kind, version: p.version, basis: p.basis, reviewedAt: p.reviewed_at,
        values: (p.machining_allowance_profile_values ?? []).map((v: any) => ({
          materialFamily: v.material_family, mouldingMethod: v.moulding_method, sizeOverMm: Number(v.size_over_mm),
          sizeUptoMm: Number(v.size_upto_mm), allowanceMm: Number(v.allowance_mm),
        })),
      })),
    });
    return { result, warnings: [] };
  }
}
