import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { lookupRoute } from './page-context.registry';
import { EntityHydratorService } from './entity-hydrator.service';

import type { SuggestionDto } from '../dto/suggestion.dto';

/**
 * Suggestions are deliberately NOT generic. The TryHackMe reference is the bar:
 *
 *   "🔍 Hey, I can see you're trying to run the `systeminfo` command,
 *    how about reviewing it? 🛠️"
 *
 * That message names a concrete thing the user just did. The Mithran
 * equivalent for a manufacturing engineer is:
 *
 *   "⚠️ Pin 2: manufacturability 62/100 (hard). Top warning: thin wall 1.2 mm
 *    on flange — want to see the redesign options?"
 *
 * To produce that we hydrate the focused entity and run a small set of
 * data-driven rules. Each rule returns either nothing or a Suggestion with:
 *   - a specific title naming the part/lot/RFQ
 *   - a one-line body with the actual number / warning / missing artifact
 *   - a `prompt` the user can fire at Echo with one click ("ask Echo")
 *
 * If no entity is focused, fall back to the route-keyed static registry.
 */
@Injectable()
export class SuggestionService {
  private readonly logger = new Logger(SuggestionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly hydrator: EntityHydratorService,
  ) {}

  async list(args: {
    ownerId: string;
    accessToken: string | null;
    route: string;
    entityType?: string | undefined;
    entityId?: string | undefined;
  }): Promise<SuggestionDto[]> {
    const dismissed = await this.fetchDismissalKeys(args);
    const isDismissed = (id: string) => dismissed.has(suggestionKey(args.route, id));

    // ── 1) Entity-specific dynamic suggestions ──────────────────────────────
    const dynamic: SuggestionDto[] = [];
    try {
      if (args.entityType === 'bom_item' && args.entityId) {
        dynamic.push(...(await this.bomItemSuggestions(args.entityId, args.accessToken)));
      } else if (args.entityType === 'project' && args.entityId) {
        dynamic.push(...(await this.projectSuggestions(args.entityId, args.accessToken)));
      } else if (args.entityType === 'bom' && args.entityId) {
        dynamic.push(...(await this.bomSuggestions(args.entityId, args.accessToken)));
      }
    } catch (e: any) {
      this.logger.warn(`dynamic suggestions failed: ${e?.message ?? e}`);
    }

    // ── 2) Static fallback (only if dynamic produced nothing) ───────────────
    let staticSuggestions: SuggestionDto[] = [];
    if (dynamic.length === 0) {
      const entry = lookupRoute(args.route);
      staticSuggestions = entry?.suggestions ?? [];
    }

    return [...dynamic, ...staticSuggestions].filter((s) => !isDismissed(s.id));
  }

  async dismiss(args: {
    ownerId: string;
    accessToken: string | null;
    route: string;
    suggestionId: string;
  }): Promise<void> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { error } = await client
      .from('echo_suggestion_dismissals')
      .upsert(
        {
          owner_id: args.ownerId,
          suggestion_key: suggestionKey(args.route, args.suggestionId),
        },
        { onConflict: 'owner_id,suggestion_key' },
      );
    if (error) throw new Error(`dismiss suggestion: ${error.message}`);
  }

  // ── Entity-specific rule sets ─────────────────────────────────────────────

  private async bomItemSuggestions(
    bomItemId: string,
    accessToken: string | null,
  ): Promise<SuggestionDto[]> {
    const client = this.supabase.getClient(accessToken ?? undefined);
    const { data } = await client
      .from('bom_items')
      .select(
        'id, name, part_number, item_type, file_3d_path, file_2d_path, manufacturability_score, difficulty_level, recommended_processes, analysis_timestamp, cad_analysis_warnings, total_cost, currency, material, annual_volume',
      )
      .eq('id', bomItemId)
      .maybeSingle();
    if (!data) return [];

    const partLabel: string =
      data.name ?? data.part_number ?? `BOM item ${shortId(bomItemId)}`;
    const out: SuggestionDto[] = [];

    // R1 — child part, no drawing
    if (data.item_type !== 'assembly' && !data.file_3d_path && !data.file_2d_path) {
      out.push({
        id: `dyn-no-drawing-${bomItemId}`,
        title: `${partLabel} has no drawing uploaded`,
        body: `Process planning and DFM both need a drawing. Upload a 2D PDF or 3D STEP to unblock manufacturing analysis.`,
        ctaLabel: 'Upload drawing',
        source: 'dynamic',
      });
    }

    // R2 — DFM never run
    const hasDfm = data.manufacturability_score != null || !!data.analysis_timestamp;
    const hasDrawing = !!data.file_3d_path || !!data.file_2d_path;
    if (!hasDfm && hasDrawing) {
      out.push({
        id: `dyn-no-dfm-${bomItemId}`,
        title: `${partLabel}: no DFM review yet`,
        body: `Drawing is uploaded but manufacturability hasn't been checked. Echo can review wall thickness, undercuts, tolerances, and recommend processes.`,
        ctaLabel: 'Run DFM review',
        source: 'dynamic',
      });
    }

    // R3 — DFM exists, but score is low or warnings present
    if (hasDfm && data.manufacturability_score != null) {
      const score100 = Math.round(
        data.manufacturability_score <= 1
          ? data.manufacturability_score * 100
          : data.manufacturability_score,
      );
      const warnings = Array.isArray(data.cad_analysis_warnings)
        ? data.cad_analysis_warnings
        : [];
      const firstWarning = warnings[0];
      const warningSummary =
        typeof firstWarning === 'string'
          ? firstWarning
          : firstWarning?.message ?? firstWarning?.title ?? null;

      if (score100 < 70) {
        out.push({
          id: `dyn-low-dfm-${bomItemId}`,
          title: `${partLabel}: manufacturability ${score100}/100 (${data.difficulty_level ?? 'hard'})`,
          body: warningSummary
            ? `Top warning: ${String(warningSummary).slice(0, 140)}. Want options to redesign or alternate processes?`
            : `Score is below 70. Echo can suggest process alternatives, material swaps, and supplier capability matches.`,
          ctaLabel: 'Why so low?',
          source: 'dynamic',
        });
      } else if (warnings.length > 0 && warningSummary) {
        out.push({
          id: `dyn-warnings-${bomItemId}`,
          title: `${partLabel}: ${warnings.length} DFM warning${warnings.length > 1 ? 's' : ''}`,
          body: `${String(warningSummary).slice(0, 140)} — review the impact on cost and lead time.`,
          ctaLabel: 'Review warnings',
          source: 'dynamic',
        });
      }
    }

    // R4 — no cost computed
    const totalCost = Number(data.total_cost);
    if (!Number.isFinite(totalCost) || totalCost <= 0) {
      out.push({
        id: `dyn-no-cost-${bomItemId}`,
        title: `${partLabel}: cost not yet computed`,
        body: `Material, process, tooling, packaging and procured-parts costs are all blank. Echo can walk you through what's needed first.`,
        ctaLabel: 'What\'s blocking cost?',
        source: 'dynamic',
      });
    }

    // R5 — high-volume part, costs not optimised
    if (
      data.annual_volume &&
      Number(data.annual_volume) >= 10000 &&
      data.manufacturability_score != null &&
      data.manufacturability_score <= 0.8
    ) {
      out.push({
        id: `dyn-vol-vs-mfg-${bomItemId}`,
        title: `${partLabel}: ${Number(data.annual_volume).toLocaleString()} units/yr at difficulty "${data.difficulty_level ?? 'hard'}"`,
        body: `High annual volume × low manufacturability is the textbook VAVE candidate. Echo can scan VAVE ideas and benchmark alternatives.`,
        ctaLabel: 'Find VAVE ideas',
        source: 'dynamic',
      });
    }

    return out.slice(0, 3);
  }

  private async bomSuggestions(
    bomId: string,
    accessToken: string | null,
  ): Promise<SuggestionDto[]> {
    const client = this.supabase.getClient(accessToken ?? undefined);
    const out: SuggestionDto[] = [];

    // R1 — items with no drawing
    const { data: noDrawing } = await client
      .from('bom_items')
      .select('id, name, part_number, item_type')
      .eq('bom_id', bomId)
      .neq('item_type', 'assembly')
      .is('file_3d_path', null)
      .is('file_2d_path', null)
      .limit(5);
    if (noDrawing && noDrawing.length > 0) {
      const sample = noDrawing[0]!;
      const label = sample.name ?? sample.part_number ?? 'one part';
      out.push({
        id: `dyn-bom-no-drawings-${bomId}`,
        title: `${noDrawing.length} part${noDrawing.length > 1 ? 's' : ''} on this BOM have no drawing`,
        body: `Starting with ${label}. Without drawings, neither DFM nor process planning can run on these items.`,
        ctaLabel: 'Show parts',
        source: 'dynamic',
      });
    }

    // R2 — items with low DFM
    const { data: low } = await client
      .from('bom_items')
      .select('id, name, part_number, manufacturability_score, difficulty_level')
      .eq('bom_id', bomId)
      .not('manufacturability_score', 'is', null)
      .lt('manufacturability_score', 0.7)
      .order('manufacturability_score', { ascending: true })
      .limit(3);
    if (low && low.length > 0) {
      const worst = low[0]!;
      const score = Math.round(Number(worst.manufacturability_score) * 100);
      out.push({
        id: `dyn-bom-low-dfm-${bomId}`,
        title: `${low.length} part${low.length > 1 ? 's' : ''} have manufacturability below 70`,
        body: `Worst: ${worst.name ?? worst.part_number} at ${score}/100 (${worst.difficulty_level ?? 'hard'}). Echo can rank cost-impact and suggest redesign.`,
        ctaLabel: 'Show worst parts',
        source: 'dynamic',
      });
    }

    return out.slice(0, 2);
  }

  private async projectSuggestions(
    projectId: string,
    accessToken: string | null,
  ): Promise<SuggestionDto[]> {
    const client = this.supabase.getClient(accessToken ?? undefined);
    const out: SuggestionDto[] = [];

    // R1 — pending RFQs
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { data: rfqs } = await client
      .from('rfq_tracking')
      .select('id, vendor_count, sent_at')
      .eq('project_id', projectId)
      .eq('status', 'sent')
      .lt('sent_at', cutoff)
      .limit(3);
    if (rfqs && rfqs.length > 0) {
      const oldest = rfqs.reduce((a: any, b: any) =>
        new Date(a.sent_at).getTime() < new Date(b.sent_at).getTime() ? a : b,
      );
      const days = Math.floor((Date.now() - new Date(oldest.sent_at).getTime()) / 86_400_000);
      out.push({
        id: `dyn-proj-rfq-pending-${projectId}`,
        title: `${rfqs.length} RFQ${rfqs.length > 1 ? 's' : ''} pending response > 3 days`,
        body: `Oldest is ${days} days old with ${oldest.vendor_count ?? 0} vendors invited. Want a follow-up draft?`,
        ctaLabel: 'Draft follow-up',
        source: 'dynamic',
      });
    }

    // R2 — BOM items with no plan
    const { data: noPlan } = await client
      .from('bom_items')
      .select('id, bom_id, name, part_number')
      .eq('project_id', projectId)
      .neq('item_type', 'assembly')
      .is('analysis_timestamp', null)
      .limit(5);
    if (noPlan && noPlan.length > 0) {
      const sample = noPlan[0]!;
      out.push({
        id: `dyn-proj-no-plan-${projectId}`,
        title: `${noPlan.length} part${noPlan.length > 1 ? 's' : ''} have no manufacturing analysis`,
        body: `Including ${sample.name ?? sample.part_number}. Run process planning to unblock cost rollup.`,
        ctaLabel: 'Open process planning',
        source: 'dynamic',
      });
    }

    return out.slice(0, 2);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private async fetchDismissalKeys(args: {
    ownerId: string;
    accessToken: string | null;
  }): Promise<Set<string>> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_suggestion_dismissals')
      .select('suggestion_key')
      .eq('owner_id', args.ownerId)
      .order('dismissed_at', { ascending: false })
      .limit(200);
    if (error) {
      this.logger.warn(`fetchDismissalKeys: ${error.message}`);
      return new Set();
    }
    return new Set((data ?? []).map((r: any) => r.suggestion_key));
  }
}

function suggestionKey(route: string, id: string): string {
  return `${route}|${id}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
