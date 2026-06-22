/**
 * Hooks for the Manufacturing Knowledge Base API.
 *
 * Surfaces:
 *   - useFeatureProcessMappings  — feature → process mapping table
 *   - useRoutingRules            — process ordering constraints
 *   - useRoutingTemplates        — part-family routing templates
 *   - useMachineCapabilities     — machine → supported processes
 *   - useKbFeedback              — fetch past feedback for a BOM item
 *   - useSubmitKbFeedback        — POST engineer correction
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../client';

// ─── Types (mirror backend kb.dto.ts) ───────────────────────────────────────

export interface RouteIssue {
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message: string;
  affectedProcesses: string[];
  suggestedFix?: string;
}

export interface FeatureProcessMapping {
  id: string;
  featureType: string;
  primaryProcess: string;
  secondaryProcesses: string[] | null;
  prerequisiteProcess: string | null;
  typicalMachineType: string | null;
  notes: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface ProcessRoutingRule {
  id: string;
  ruleName: string;
  firstProcess: string;
  secondProcess: string;
  constraintType: string;
  severity: 'error' | 'warning';
  message: string;
  suggestedFix: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface PartFamilyRoutingTemplate {
  id: string;
  partFamily: string;
  templateName: string;
  complexityLevel: string | null;
  routingSequence: any[];
  notes: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface MachineCapability {
  id: string;
  machineName: string;
  machineType: string;
  supportedProcesses: string[];
  isSystem: boolean;
  createdAt: string;
}

export interface ProcessPlanFeedback {
  id: string;
  bomItemId: string;
  aiProcessSequence: string[];
  engineerSequence: string[];
  correctionReason: string | null;
  partFamily: string | null;
  isTrainingCandidate: boolean;
  createdAt: string;
}

export interface SubmitFeedbackDto {
  bomItemId: string;
  aiProcessSequence: string[];
  aiMachines?: Record<string, string>;
  engineerSequence: string[];
  engineerMachines?: Record<string, string>;
  correctionReason?: string;
  partFamily?: string;
  material?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE = '/manufacturing-knowledge';

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export function useFeatureProcessMappings() {
  return useQuery({
    queryKey: ['kb-feature-process-mappings'],
    queryFn: async (): Promise<FeatureProcessMapping[]> => {
      return apiClient.get<FeatureProcessMapping[]>(`${BASE}/feature-process-mapping`);
    },
    staleTime: 5 * 60_000,
  });
}

export function useRoutingRules(partFamily?: string) {
  return useQuery({
    queryKey: ['kb-routing-rules', partFamily ?? null],
    queryFn: async (): Promise<ProcessRoutingRule[]> => {
      const url = partFamily
        ? `${BASE}/routing-rules?partFamily=${encodeURIComponent(partFamily)}`
        : `${BASE}/routing-rules`;
      return apiClient.get<ProcessRoutingRule[]>(url);
    },
    staleTime: 5 * 60_000,
  });
}

export function useRoutingTemplates(partFamily?: string) {
  return useQuery({
    queryKey: ['kb-routing-templates', partFamily ?? null],
    queryFn: async (): Promise<PartFamilyRoutingTemplate[]> => {
      const url = partFamily
        ? `${BASE}/templates?partFamily=${encodeURIComponent(partFamily)}`
        : `${BASE}/templates`;
      return apiClient.get<PartFamilyRoutingTemplate[]>(url);
    },
    staleTime: 5 * 60_000,
  });
}

export function useMachineCapabilities() {
  return useQuery({
    queryKey: ['kb-machine-capabilities'],
    queryFn: async (): Promise<MachineCapability[]> => {
      return apiClient.get<MachineCapability[]>(`${BASE}/machine-capabilities`);
    },
    staleTime: 5 * 60_000,
  });
}

export function useKbFeedback(bomItemId: string) {
  return useQuery({
    queryKey: ['kb-feedback', bomItemId],
    queryFn: async (): Promise<ProcessPlanFeedback[]> => {
      return apiClient.get<ProcessPlanFeedback[]>(`${BASE}/feedback/${bomItemId}`);
    },
    enabled: !!bomItemId,
    staleTime: 30_000,
  });
}

// ─── Mutation Hooks ───────────────────────────────────────────────────────────

export function useSubmitKbFeedback() {
  return useMutation({
    mutationFn: async (dto: SubmitFeedbackDto): Promise<ProcessPlanFeedback> => {
      return apiClient.post<ProcessPlanFeedback>(`${BASE}/feedback`, dto);
    },
  });
}
