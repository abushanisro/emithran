import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { AiBudgetService, type AiCaller, type AiUseCase } from '../../../common/ai/ai-budget.service';
import { VaveService } from '../vave.service';
import type { VaveBomItemResponseDto } from '../dto/vave.dto';
import type { VaveBomAnalysisDto } from './vave-ai.dto';
import { bomAnalysisPrompt, costAnalysisPrompt, ideationPrompt, shouldCostPrompt } from './vave-ai.prompts';
import {
  AiResultError,
  bomInsightsFromAi,
  costAnalysisFromAi,
  ideasFromAi,
  parseAiJson,
  shouldCostFromAi,
  type AffinityGroup,
  type QFDMatrix,
  type ShouldCostResult,
  type VaveIdeaDraft,
} from './vave-ai.results';

/** The model the VAVE analyses use. */
export const VAVE_AI_MODEL = 'claude-sonnet-5-5';

export interface ParetoItem {
  id: string;
  partNumber: string;
  description: string | null;
  annualSpend: number;
  cumulativePct: number;
  isTopTwenty: boolean;
}

export interface CostAnalysisResult {
  paretoItems: ParetoItem[];
  affinityGroups: AffinityGroup[];
  focusAreas: string[];
  qfdMatrix?: QFDMatrix;
}

/**
 * The VAVE AI analyses. They used to run in Next.js route handlers on their own API key with a per-instance request cap; they now
 * run here, so every call goes through AiBudgetService (one budget, one key) and every prompt is built on the server: from the
 * project's own rows for project analyses, from validated structured metrics for the benchmark analysis.
 */
@Injectable()
export class VaveAiService {
  constructor(
    private readonly vave: VaveService,
    private readonly ai: AiBudgetService,
  ) {}

  async costAnalysis(projectId: string, caller: AiCaller): Promise<CostAnalysisResult> {
    const items = await this.projectItems(projectId, caller);
    const answer = await this.ask(caller, 'vave_cost_analysis', costAnalysisPrompt(items), 'medium');
    const ai = this.parse(() => costAnalysisFromAi(answer(), new Map(items.map((i) => [i.partNumber, i.annualSpend]))));

    // Pareto with cumulative percentage, computed here: no AI needed.
    const sorted = [...items].sort((a, b) => b.annualSpend - a.annualSpend);
    const totalSpend = sorted.reduce((s, i) => s + i.annualSpend, 0);
    let cumulative = 0;
    const paretoItems = sorted.map((item) => {
      cumulative += item.annualSpend;
      const cumulativePct = totalSpend > 0 ? (cumulative / totalSpend) * 100 : 0;
      return {
        id: item.id,
        partNumber: item.partNumber,
        description: item.description,
        annualSpend: item.annualSpend,
        cumulativePct,
        isTopTwenty: cumulativePct <= 80 && totalSpend > 0 && item.annualSpend / totalSpend >= 0.005,
      };
    });
    return { paretoItems, ...ai };
  }

  async ideation(projectId: string, caller: AiCaller): Promise<VaveIdeaDraft[]> {
    const items = await this.projectItems(projectId, caller);
    const shouldCosts = await this.vave.findShouldCosts(projectId, caller.accessToken);
    const answer = await this.ask(caller, 'vave_ideation', ideationPrompt(items, shouldCosts), 'medium');
    return this.parse(() => ideasFromAi(answer()));
  }

  async shouldCost(projectId: string, itemId: string, caller: AiCaller): Promise<ShouldCostResult> {
    const part = (await this.vave.findBomItems(projectId, caller.accessToken)).find((i) => i.id === itemId);
    if (!part) throw new NotFoundException('BOM item not found in this VAVE project');
    const answer = await this.ask(caller, 'vave_should_cost', shouldCostPrompt(part), 'low');
    return this.parse(() => shouldCostFromAi(part, answer()));
  }

  async bomAnalysis(input: VaveBomAnalysisDto, caller: AiCaller): Promise<Record<string, unknown>> {
    const answer = await this.ask(caller, 'vave_bom_analysis', bomAnalysisPrompt(input), 'medium');
    return this.parse(() => bomInsightsFromAi(answer()));
  }

  private async projectItems(projectId: string, caller: AiCaller): Promise<VaveBomItemResponseDto[]> {
    const items = await this.vave.findBomItems(projectId, caller.accessToken);
    if (!items.length) throw new BadRequestException('Add BOM items to this VAVE project first.');
    return items;
  }

  /** One model call through the budget; returns a parser of its JSON answer. Refusals and empty answers are 502. */
  private async ask(caller: AiCaller, useCase: AiUseCase, prompt: string, effort: 'low' | 'medium'): Promise<() => unknown> {
    const session = await this.ai.open(caller, useCase);
    try {
      const message = await session.create({
        model: VAVE_AI_MODEL,
        output_config: { effort },
        messages: [{ role: 'user', content: prompt }],
      });
      if (message.stop_reason === 'refusal') throw new BadGatewayException('The AI service declined the request.');
      // With thinking on, the first content block is not necessarily the text.
      const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (!text.trim()) throw new BadGatewayException('The AI service returned no text.');
      return () => parseAiJson(text);
    } finally {
      session.close();
    }
  }

  private parse<T>(read: () => T): T {
    try {
      return read();
    } catch (error) {
      if (error instanceof AiResultError) throw new BadGatewayException(error.message);
      throw error;
    }
  }
}
