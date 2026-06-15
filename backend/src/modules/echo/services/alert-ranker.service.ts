import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CandidateAlert } from './alert-detector.service';

export interface RankedAlert extends CandidateAlert {
  nextAction: string;
}

const RANKER_MODEL = 'claude-haiku-4-5-20251001';
const RANKER_MAX_TOKENS = 600;
const RANKER_TIMEOUT_MS = 15_000;
const RANKER_TOP_N = 5;

/**
 * One-shot Claude call that takes raw rule-detected alerts and decides which
 * to surface, in what order, with what severity, and with a concrete
 * `nextAction` recommendation per alert.
 *
 * If the LLM is unavailable or returns garbage, we fall back to a
 * deterministic severity-ordered list — Echo's alert UI never goes dark.
 */
@Injectable()
export class AlertRankerService {
  private readonly logger = new Logger(AlertRankerService.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey =
      this.config.get<string>('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY ?? '';
  }

  async rank(candidates: CandidateAlert[]): Promise<RankedAlert[]> {
    if (candidates.length === 0) return [];

    // Fast path: too few candidates → AI can't help, skip the call.
    if (candidates.length <= 2 || !this.apiKey) {
      return this.fallback(candidates);
    }

    try {
      const ai = await this.callRanker(candidates);
      if (ai && ai.length > 0) return ai;
      return this.fallback(candidates);
    } catch (e: any) {
      this.logger.warn(`alert ranker failed, falling back: ${e?.message ?? e}`);
      return this.fallback(candidates);
    }
  }

  private async callRanker(candidates: CandidateAlert[]): Promise<RankedAlert[] | null> {
    const system = [
      {
        type: 'text',
        text: `You triage manufacturing alerts for the Mithran platform's Echo copilot. You will be given an array of CANDIDATE alerts that came from rule-based detection (pending RFQs, stale production lots, cost spikes, missing process plans, missing drawings).

Return ONLY a JSON array (no prose, no markdown) of up to ${RANKER_TOP_N} objects with this shape:
[
  { "index": <0-based index into the input array>, "severity": "info"|"warn"|"urgent", "nextAction": "<one short sentence>" }
]

Rules:
- Pick the most actionable items. Skip duplicates (same kind+source).
- "urgent" only when delay/risk is material (RFQ pending > 7d, stale lot > 10d, cost spike > 25%).
- "nextAction" must be specific and short (< 120 chars). Example: "Email the 3 pending vendors today to confirm a quote ETA."
- If fewer than ${RANKER_TOP_N} merit surfacing, return a shorter array.
- Output MUST be parseable JSON.`,
        cache_control: { type: 'ephemeral' },
      },
    ];

    const userMessage = JSON.stringify(
      candidates.map((c, i) => ({
        index: i,
        kind: c.kind,
        severity: c.severity,
        title: c.title,
        body: c.body,
        metadata: c.metadata,
      })),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RANKER_TIMEOUT_MS);
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: RANKER_MODEL,
          max_tokens: RANKER_MAX_TOKENS,
          temperature: 0,
          system,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const body = await resp.json();
      const text: string = (body.content ?? [])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
        .trim();

      const parsed = this.safeParseJsonArray(text);
      if (!parsed) return null;

      const ranked: RankedAlert[] = [];
      for (const raw of parsed.slice(0, RANKER_TOP_N)) {
        const item = raw as { index?: unknown; severity?: unknown; nextAction?: unknown };
        const idx = Number(item.index);
        const src = candidates[idx];
        if (!src) continue;
        const severity = isSeverity(item.severity) ? item.severity : src.severity;
        const nextAction = typeof item.nextAction === 'string' ? item.nextAction.slice(0, 200) : defaultActionFor(src.kind);
        ranked.push({ ...src, severity, nextAction });
      }
      return ranked;
    } finally {
      clearTimeout(timer);
    }
  }

  private fallback(candidates: CandidateAlert[]): RankedAlert[] {
    const order: Record<string, number> = { urgent: 0, warn: 1, info: 2 };
    return [...candidates]
      .sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
      .slice(0, RANKER_TOP_N)
      .map((c) => ({ ...c, nextAction: defaultActionFor(c.kind) }));
  }

  private safeParseJsonArray(text: string): unknown[] | null {
    // Tolerate a stray code fence or leading prose.
    const trimmed = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function isSeverity(v: unknown): v is 'info' | 'warn' | 'urgent' {
  return v === 'info' || v === 'warn' || v === 'urgent';
}

function defaultActionFor(kind: string): string {
  switch (kind) {
    case 'rfq_pending':
      return 'Follow up with pending vendors and set a response deadline.';
    case 'stale_lot':
      return 'Open the lot and log a status update or close it.';
    case 'cost_spike':
      return 'Open the BOM item and audit recent rate or scope changes.';
    case 'missing_plan':
      return 'Run the AI process planner on this BOM item.';
    case 'missing_drawing':
      return 'Upload the drawing — DFM and process planning need it.';
    case 'cost_outlier':
      return 'Compare against benchmark and review supplier capability.';
    default:
      return 'Open the linked module and review.';
  }
}
