import { apiClient } from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VaveProject {
  id: string;
  name: string;
  productFamily: string | null;
  description: string | null;
  status: 'phase1' | 'phase2' | 'phase3' | 'complete';
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  bomCount?: number;
  ideaCount?: number;
  totalSavings?: number;
}

export interface VaveBomItem {
  id: string;
  projectId: string;
  partNumber: string;
  description: string | null;
  level: number;
  parentPn: string | null;
  quantity: number;
  unitCost: number;
  annualVolume: number;
  annualSpend: number;
  material: string | null;
  process: string | null;
  supplierName: string | null;
  drawingUrl: string | null;
  modelUrl: string | null;
  drawingAnalysis: DrawingAnalysisResult | null;
  createdAt: string;
}

export interface VaveIdea {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  framework: 'SCAMPER' | 'TRIZ' | 'FAST' | 'Manual';
  scamperType: string | null;
  affectedParts: string[];
  estSavingsUsd: number;
  estInvestmentUsd: number;
  feasibility: 'High' | 'Medium' | 'Low';
  complexity: 'L1' | 'L2' | 'L3';
  risk: 'High' | 'Medium' | 'Low';
  quadrant: 'QuickWin' | 'Strategic' | 'FillIn' | 'Avoid' | null;
  status: 'draft' | 'approved' | 'in-progress' | 'done';
  timeToImplementMonths: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaveShouldCost {
  id: string;
  projectId: string;
  partNumber: string;
  description: string | null;
  actualCost: number;
  shouldCost: number;
  delta: number;
  deltaPct: number | null;
  materialCost: number | null;
  processCost: number | null;
  overhead: number | null;
  margin: number | null;
  benchmarkSource: string | null;
  createdAt: string;
}

export interface DrawingAnalysisResult {
  material: string;
  process: string;
  dimensions_mm: { L: number; W: number; H: number };
  tightest_tolerance_mm: number;
  surface_finish_ra: number;
  heat_treatment: string;
  coating: string;
  complexity: 'simple' | 'medium' | 'complex';
}

export interface CreateVaveProject {
  name: string;
  productFamily?: string;
  description?: string;
}

export interface UpdateVaveProject extends Partial<CreateVaveProject> {
  status?: 'phase1' | 'phase2' | 'phase3' | 'complete';
}

export interface CreateVaveBomItem {
  partNumber: string;
  description?: string;
  level?: number;
  parentPn?: string;
  quantity?: number;
  unitCost?: number;
  annualVolume?: number;
  material?: string;
  process?: string;
  supplierName?: string;
  drawingUrl?: string;
  modelUrl?: string;
  drawingAnalysis?: Record<string, any>;
}

export interface CreateVaveIdea {
  title: string;
  description?: string;
  framework?: 'SCAMPER' | 'TRIZ' | 'FAST' | 'Manual';
  scamperType?: string;
  affectedParts?: string[];
  estSavingsUsd?: number;
  estInvestmentUsd?: number;
  feasibility?: 'High' | 'Medium' | 'Low';
  complexity?: 'L1' | 'L2' | 'L3';
  risk?: 'High' | 'Medium' | 'Low';
  quadrant?: 'QuickWin' | 'Strategic' | 'FillIn' | 'Avoid';
  status?: 'draft' | 'approved' | 'in-progress' | 'done';
  timeToImplementMonths?: number;
}

export interface CreateVaveShouldCost {
  partNumber: string;
  description?: string;
  actualCost: number;
  shouldCost: number;
  deltaPct?: number;
  materialCost?: number;
  processCost?: number;
  overhead?: number;
  margin?: number;
  benchmarkSource?: string;
}

// ─── Cost Analysis AI response types ─────────────────────────────────────────

export interface ParetoItem {
  id: string;
  partNumber: string;
  description: string | null;
  annualSpend: number;
  cumulativePct: number;
  isTopTwenty: boolean;
}

export interface AffinityGroup {
  name: string;
  parts: string[];
  totalCost: number;
  description: string;
}

export interface QFDRelationship {
  need: string;
  function: string;
  weight: 'Strong' | 'Medium' | 'Weak' | 'None';
}

export interface QFDMatrix {
  customerNeeds: string[];
  functions: string[];
  relationships: QFDRelationship[];
}

export interface CostAnalysisResult {
  paretoItems: ParetoItem[];
  affinityGroups: AffinityGroup[];
  focusAreas: string[];
  qfdMatrix?: QFDMatrix;
}

export interface ShouldCostResult {
  shouldCost: number;
  materialCost: number;
  processCost: number;
  overhead: number;
  margin: number;
  delta: number;
  deltaPct: number;
  benchmarkSource: string;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const vaveApi = {
  // Projects
  getProjects: () =>
    apiClient.get<VaveProject[]>('/vave/projects'),

  getProject: (id: string) =>
    apiClient.get<VaveProject>(`/vave/projects/${id}`),

  createProject: (data: CreateVaveProject) =>
    apiClient.post<VaveProject>('/vave/projects', data),

  updateProject: (id: string, data: UpdateVaveProject) =>
    apiClient.put<VaveProject>(`/vave/projects/${id}`, data),

  deleteProject: (id: string) =>
    apiClient.delete(`/vave/projects/${id}`),

  // BOM
  getBomItems: (projectId: string) =>
    apiClient.get<VaveBomItem[]>(`/vave/projects/${projectId}/bom`),

  createBomItem: (projectId: string, data: CreateVaveBomItem) =>
    apiClient.post<VaveBomItem>(`/vave/projects/${projectId}/bom`, data),

  bulkImportBom: (projectId: string, items: CreateVaveBomItem[]) =>
    apiClient.post<VaveBomItem[]>(`/vave/projects/${projectId}/bom/bulk`, { items }),

  deleteBomItem: (projectId: string, itemId: string) =>
    apiClient.delete(`/vave/projects/${projectId}/bom/${itemId}`),

  // Ideas
  getIdeas: (projectId: string) =>
    apiClient.get<VaveIdea[]>(`/vave/projects/${projectId}/ideas`),

  createIdea: (projectId: string, data: CreateVaveIdea) =>
    apiClient.post<VaveIdea>(`/vave/projects/${projectId}/ideas`, data),

  bulkCreateIdeas: (projectId: string, ideas: CreateVaveIdea[]) =>
    apiClient.post<VaveIdea[]>(`/vave/projects/${projectId}/ideas/bulk`, { ideas }),

  updateIdea: (projectId: string, ideaId: string, data: Partial<CreateVaveIdea>) =>
    apiClient.put<VaveIdea>(`/vave/projects/${projectId}/ideas/${ideaId}`, data),

  deleteIdea: (projectId: string, ideaId: string) =>
    apiClient.delete(`/vave/projects/${projectId}/ideas/${ideaId}`),

  // Should Costs
  getShouldCosts: (projectId: string) =>
    apiClient.get<VaveShouldCost[]>(`/vave/projects/${projectId}/should-costs`),

  upsertShouldCost: (projectId: string, data: CreateVaveShouldCost) =>
    apiClient.post<VaveShouldCost>(`/vave/projects/${projectId}/should-costs`, data),

  deleteShouldCost: (projectId: string, costId: string) =>
    apiClient.delete(`/vave/projects/${projectId}/should-costs/${costId}`),
};
