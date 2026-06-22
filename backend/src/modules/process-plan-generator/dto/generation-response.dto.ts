import { EngineeringBrief } from './engineering-brief.dto';
import { CandidateSet } from './candidate-set.dto';
import { AbstractPlan } from './abstract-plan.dto';
import { DraftPackage } from './draft-line.dto';
import type { RouteIssue } from '../../manufacturing-knowledge/dto/kb.dto';
import type { ManufacturingImplication } from './manufacturing-implication.dto';

export type GenerationStatus =
  | 'running'
  | 'draft_ready'
  | 'applied'
  | 'failed'
  | 'discarded'
  | 'out_of_scope';

export interface ToolCallLogEntry {
  index: number;
  toolName: 'expand_candidates' | 'save_draft';
  input: Record<string, any>;
  result: Record<string, any> | { error: string };
  durationMs: number;
}

export interface GenerationResponse {
  id: string;
  bomItemId: string;
  status: GenerationStatus;
  model: string;

  scopeDecision: EngineeringBrief['scope'];
  brief: EngineeringBrief;
  candidates: CandidateSet;

  abstractPlan: AbstractPlan | null;
  draft: DraftPackage | null;

  toolCalls: ToolCallLogEntry[];

  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;

  creditCost: number;

  errorMessage: string | null;
  errorStage: string | null;

  routeValidationIssues?: RouteIssue[];
  hasValidationErrors?: boolean;
  partFamily?: string;
  templateUsed?: string | null;
  implications?: ManufacturingImplication[];

  startedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
}
