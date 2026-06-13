import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { fromBuffer } from 'pdf2pic';

import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { DrawingBrief } from '../dto/drawing-brief.dto';
import { UNAVAILABLE_DRAWING_BRIEF } from '../dto/drawing-brief.dto';

const EXTRACTION_MODEL = 'claude-sonnet-4-6';
const EXTRACTION_MAX_TOKENS = 4096;
const VISION_TIMEOUT_MS = 60_000;
const STORAGE_BUCKET = process.env.SUPABASE_BUCKET_BOM_FILES || 'bom-files';
const SIGNED_URL_TTL_SEC = 300;

/**
 * Extracts a structured DrawingBrief from a BOM item's 2D PDF drawing.
 *
 * Strategy:
 *   1. If bom_items.drawing_extraction already cached, return it (no cost).
 *   2. If file_2d_path is missing, return UNAVAILABLE_DRAWING_BRIEF (the
 *      orchestrator will just generate from 3D+BOM only).
 *   3. Otherwise: download PDF from Supabase Storage → convert first page
 *      to PNG via pdf2pic → send PNG to Claude vision with a structured
 *      extraction prompt → validate the JSON shape → cache on the BOM item.
 *
 * We use Claude vision (not the QC module's tesseract path) because tesseract
 * misses GD&T symbols, surface-finish triangles, thread callouts, and
 * datum references — exactly the content that drives process choice.
 */
@Injectable()
export class DrawingExtractorService {
  private readonly logger = new Logger(DrawingExtractorService.name);
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    this.apiKey =
      this.configService.get<string>('ANTHROPIC_API_KEY') ??
      process.env.ANTHROPIC_API_KEY ??
      '';
  }

  async getBriefFor(
    bomItemId: string,
    bomRow: any,
    accessToken: string | null,
  ): Promise<DrawingBrief> {
    // ── 1) Cached? ──────────────────────────────────────────────────────────
    const cached = bomRow?.drawing_extraction as DrawingBrief | null | undefined;
    if (cached && cached.available && cached.sourceFilePath === bomRow.file_2d_path) {
      this.logger.log(`Drawing brief for ${bomItemId}: cache hit`);
      return { ...cached, source: 'cache' };
    }

    // ── 2) No 2D file → nothing to extract ─────────────────────────────────
    if (!bomRow?.file_2d_path) {
      return { ...UNAVAILABLE_DRAWING_BRIEF, source: 'unavailable' };
    }

    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured — skipping drawing extraction');
      return { ...UNAVAILABLE_DRAWING_BRIEF };
    }

    // ── 3) Fresh extraction ────────────────────────────────────────────────
    try {
      const pngBase64 = await this.fetchAndRasterise(bomRow.file_2d_path, accessToken);
      if (!pngBase64) {
        return { ...UNAVAILABLE_DRAWING_BRIEF };
      }

      const brief = await this.callClaudeVision(pngBase64, bomRow.file_2d_path);
      const finalBrief: DrawingBrief = {
        ...brief,
        source: 'fresh',
        extractedAt: new Date().toISOString(),
        extractionModel: EXTRACTION_MODEL,
        sourceFilePath: bomRow.file_2d_path,
      };

      // Cache on bom_items so subsequent generates are free
      await this.cacheOnBomItem(bomItemId, finalBrief, accessToken);
      this.logger.log(
        `Drawing brief for ${bomItemId}: extracted ${finalBrief.dimensions.length} dims, ${finalBrief.gdt.length} GD&T, ${finalBrief.surfaceFinishes.length} surface-finishes, ${finalBrief.holes.length} holes`,
      );
      return finalBrief;
    } catch (e: any) {
      this.logger.warn(`Drawing extraction failed for ${bomItemId}: ${e.message}`);
      return { ...UNAVAILABLE_DRAWING_BRIEF, extractionWarnings: [String(e.message ?? e).slice(0, 200)] };
    }
  }

  // ── Storage → PNG ────────────────────────────────────────────────────────

  private async fetchAndRasterise(storagePath: string, accessToken: string | null): Promise<string | null> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { data, error } = await client
      .storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) {
      this.logger.warn(`Signed URL for ${storagePath} failed: ${error?.message ?? 'unknown'}`);
      return null;
    }

    const res = await axios.get<ArrayBuffer>(data.signedUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 50 * 1024 * 1024,
    });
    const pdfBuffer = Buffer.from(res.data);

    // Render first page at 200 DPI. Engineering drawings need detail; we cap
    // to 1800px width to keep vision-token cost bounded.
    const converter = fromBuffer(pdfBuffer, {
      density: 200,
      format: 'png',
      width: 1800,
      preserveAspectRatio: true,
      saveFilename: 'page',
    });

    let pageResult: any;
    try {
      pageResult = await converter(1, { responseType: 'base64' });
    } catch (e: any) {
      this.logger.warn(`pdf2pic rasterise failed: ${e.message}`);
      return null;
    }

    const base64 = pageResult?.base64 ?? pageResult?.data;
    if (!base64 || typeof base64 !== 'string') {
      this.logger.warn('pdf2pic returned no base64 data');
      return null;
    }
    return base64;
  }

  // ── Claude vision ────────────────────────────────────────────────────────

  private async callClaudeVision(pngBase64: string, sourcePath: string): Promise<DrawingBrief> {
    const systemPrompt = `You are a senior manufacturing engineer reading an Indian-shop 2D engineering drawing.
Your job is to extract a structured JSON description of every callout that drives process planning.

Return ONLY a JSON object matching the EXACT schema below. No prose, no markdown fences.

{
  "drawingNumber": string | null,
  "revision": string | null,
  "title": string | null,
  "scale": string | null,
  "material": string | null,
  "heatTreatment": string | null,
  "surfaceTreatment": string | null,
  "hardness": string | null,
  "generalTolerance": string | null,
  "datums": [{ "label": "A"|"B"|..., "feature": "..." }],
  "dimensions": [{
    "balloon": int | null,
    "label": "short feature description",
    "nominal": number,
    "unit": "mm" | "in" | "deg" | ...,
    "upperTol": number | null,
    "lowerTol": number | null,
    "toleranceClass": "h7" | "H8" | "IT8" | "k6" | ... | null,
    "type": "linear" | "diameter" | "radius" | "angular"
  }],
  "gdt": [{
    "feature": "...",
    "symbol": "position" | "concentricity" | "circularity" | "cylindricity"
             | "flatness" | "straightness" | "perpendicularity" | "parallelism"
             | "angularity" | "runout" | "total_runout" | "symmetry"
             | "profile_line" | "profile_surface",
    "tolerance": number,
    "datumRefs": ["A","B",...],
    "modifier": "M" | "L" | "P" | null
  }],
  "surfaceFinishes": [{
    "feature": "...",
    "raMicrons": number | null,
    "rzMicrons": number | null,
    "directionSymbol": string | null
  }],
  "threads": [{ "feature": "...", "spec": "M6×1" | "1/4-20 UNC" | ... }],
  "holes": [{
    "feature": "...",
    "diameter": number,
    "depth": number | null,
    "throughHole": boolean,
    "counterbore": { "diameter": number, "depth": number } | null,
    "countersink": { "diameter": number, "angle": number } | null
  }],
  "notes": [string],
  "extractionWarnings": [string]
}

Rules:
- All numeric values are mm unless the drawing explicitly says inches.
- If a field is not present on the drawing, set it to null (or [] for arrays).
- For toleranceClass, accept ISO fits (h7, H8, k6, etc.) AND IT grades.
- For GD&T, "tolerance" is the numeric tolerance zone (e.g., 0.05 for ⌖0.05).
- Heat treatment example: "Carburise, 58-62 HRC, case 0.6-0.8mm".
- If the drawing is unreadable in part, add a short note to extractionWarnings and continue.
- Do NOT invent values. If unsure, omit the entry.`;

    const userPrompt = `Extract the engineering drawing data. Source file: ${sourcePath}`;

    const body = {
      model: EXTRACTION_MODEL,
      max_tokens: EXTRACTION_MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: pngBase64,
              },
            },
            { type: 'text', text: userPrompt },
          ],
        },
      ],
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Vision API ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json() as any;
    const text = data.content?.[0]?.text ?? '';
    const json = this.parseExtraction(text);

    return this.normaliseBrief(json);
  }

  private parseExtraction(raw: string): any {
    // Strip code fences if the model wrapped despite instructions
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      return JSON.parse(stripped);
    } catch {
      // Try to find the first {...} block
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch { /* fall through */ }
      }
      throw new Error('Vision response was not valid JSON');
    }
  }

  private normaliseBrief(raw: any): DrawingBrief {
    const safeArr = <T>(v: unknown, mapper: (x: any) => T | null): T[] =>
      Array.isArray(v) ? (v.map(mapper).filter((x): x is T => x != null) as T[]) : [];

    return {
      available: true,
      source: 'fresh',
      extractedAt: null,        // filled by caller
      extractionModel: null,    // filled by caller
      sourceFilePath: null,     // filled by caller
      drawingNumber: str(raw?.drawingNumber),
      revision: str(raw?.revision),
      title: str(raw?.title),
      scale: str(raw?.scale),
      material: str(raw?.material),
      heatTreatment: str(raw?.heatTreatment),
      surfaceTreatment: str(raw?.surfaceTreatment),
      hardness: str(raw?.hardness),
      generalTolerance: str(raw?.generalTolerance),
      datums: safeArr(raw?.datums, (d) => (typeof d?.label === 'string' ? { label: d.label, feature: str(d.feature) ?? '' } : null)),
      dimensions: safeArr(raw?.dimensions, (d) => {
        if (typeof d?.nominal !== 'number') return null;
        return {
          balloon: typeof d.balloon === 'number' ? d.balloon : null,
          label: str(d.label) ?? '',
          nominal: d.nominal,
          unit: str(d.unit) ?? 'mm',
          upperTol: typeof d.upperTol === 'number' ? d.upperTol : null,
          lowerTol: typeof d.lowerTol === 'number' ? d.lowerTol : null,
          toleranceClass: str(d.toleranceClass),
          type: ['linear', 'diameter', 'radius', 'angular'].includes(d.type) ? d.type : 'linear',
        };
      }),
      gdt: safeArr(raw?.gdt, (g) => {
        if (typeof g?.tolerance !== 'number' || typeof g?.symbol !== 'string') return null;
        return {
          feature: str(g.feature) ?? '',
          symbol: g.symbol,
          tolerance: g.tolerance,
          datumRefs: Array.isArray(g.datumRefs) ? g.datumRefs.filter((x: unknown): x is string => typeof x === 'string') : [],
          modifier: str(g.modifier),
        };
      }),
      surfaceFinishes: safeArr(raw?.surfaceFinishes, (s) => ({
        feature: str(s?.feature) ?? '',
        raMicrons: typeof s?.raMicrons === 'number' ? s.raMicrons : null,
        rzMicrons: typeof s?.rzMicrons === 'number' ? s.rzMicrons : null,
        directionSymbol: str(s?.directionSymbol),
      })),
      threads: safeArr(raw?.threads, (t) => {
        if (typeof t?.spec !== 'string') return null;
        return { feature: str(t.feature) ?? '', spec: t.spec };
      }),
      holes: safeArr(raw?.holes, (h) => {
        if (typeof h?.diameter !== 'number') return null;
        return {
          feature: str(h.feature) ?? '',
          diameter: h.diameter,
          depth: typeof h.depth === 'number' ? h.depth : null,
          throughHole: !!h.throughHole,
          counterbore:
            h.counterbore && typeof h.counterbore.diameter === 'number' && typeof h.counterbore.depth === 'number'
              ? { diameter: h.counterbore.diameter, depth: h.counterbore.depth }
              : null,
          countersink:
            h.countersink && typeof h.countersink.diameter === 'number' && typeof h.countersink.angle === 'number'
              ? { diameter: h.countersink.diameter, angle: h.countersink.angle }
              : null,
        };
      }),
      notes: Array.isArray(raw?.notes) ? raw.notes.filter((n: unknown): n is string => typeof n === 'string') : [],
      extractionWarnings: Array.isArray(raw?.extractionWarnings)
        ? raw.extractionWarnings.filter((n: unknown): n is string => typeof n === 'string')
        : [],
    };
  }

  // ── Cache ───────────────────────────────────────────────────────────────

  private async cacheOnBomItem(bomItemId: string, brief: DrawingBrief, accessToken: string | null): Promise<void> {
    const client = this.supabaseService.getClient(accessToken ?? undefined);
    const { error } = await client
      .from('bom_items')
      .update({ drawing_extraction: brief })
      .eq('id', bomItemId);
    if (error) {
      this.logger.warn(`Failed to cache drawing_extraction on ${bomItemId}: ${error.message}`);
    }
  }
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
