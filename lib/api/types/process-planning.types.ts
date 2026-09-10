// Process Planning Types
// Aligned with backend DTOs and database schema

export type WorkflowState = 'draft' | 'in_review' | 'approved' | 'active' | 'archived';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export type UserRole = 'process_planner' | 'production_manager' | 'shop_floor' | 'design_engineer' | 'admin';

export type ProcessCategory =
  | 'machining'
  | 'sheet_metal'
  | 'assembly'
  | 'plastic_rubber'
  | 'post_processing'
  | 'packing_delivery';

export interface ProcessRoute {
  id: string;
  bomItemId: string;
  name: string;
  description?: string;
  isTemplate?: boolean;
  templateName?: string;
  processGroup: string;
  processCategory?: string;
  workflowState: WorkflowState;
  workflowUpdatedAt?: string;
  workflowUpdatedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdByRole: UserRole;
  assignedTo?: string;
  priority: Priority;
  totalSetupTimeMinutes: number;
  totalCycleTimeMinutes: number;
  totalCost: number;
  userId: string;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
  // Optional joined data
  partNumber?: string;
  bomItemName?: string;
  bomName?: string;
  createdByEmail?: string;
  approvedByEmail?: string;
}

export interface ProcessRouteStep {
  id: string;
  processRouteId: string;
  processId: string;
  stepNumber: number;
  operationName: string;
  setupTimeMinutes?: number;
  cycleTimeMinutes?: number;
  laborHours?: number;
  machineHours?: number;
  machineHourRateId?: string;
  laborHourRateId?: string;
  calculatedCost?: number;
  calculatorMappingId?: string;
  extractedValues?: Record<string, any>;
  isCompleted: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // Optional joined data
  processName?: string;
  processCategory?: string;
  calculatorName?: string;
}

export interface WorkflowHistory {
  id: string;
  processRouteId: string;
  fromState?: string;
  toState: string;
  changedBy: string;
  changedByRole?: string;
  comment?: string;
  createdAt: string;
  // Optional joined data
  routeName?: string;
  changedByEmail?: string;
}

export interface UserSession {
  id: string;
  userId: string;
  activeTab: ProcessCategory;
  filters: Record<string, any>;
  lastAccessedAt: string;
  createdAt: string;
}

export interface PaginatedProcessRoutes {
  routes: ProcessRoute[];
  count: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CostSummary {
  processRouteId: string;
  totalSetupTimeMinutes: number;
  totalCycleTimeMinutes: number;
  totalCost: number;
  totalSteps: number;
  steps: Array<{
    stepNumber: number;
    operationName: string;
    setupTimeMinutes: number;
    cycleTimeMinutes: number;
    calculatedCost: number;
  }>;
  calculatedAt: string;
}

// Request DTOs
export interface CreateProcessRouteRequest {
  bomItemId: string;
  name: string;
  description?: string;
  processGroup?: string;
  processCategory?: string;
  isTemplate?: boolean;
  templateName?: string;
  createdByRole?: UserRole;
  assignedTo?: string;
  priority?: Priority;
}

export interface UpdateProcessRouteRequest {
  name?: string;
  description?: string;
  processGroup?: string;
  processCategory?: string;
  isTemplate?: boolean;
  templateName?: string;
  assignedTo?: string;
  priority?: Priority;
}

export interface CreateProcessRouteStepRequest {
  processRouteId: string;
  processId: string;
  stepNumber: number;
  operationName: string;
  setupTimeMinutes?: number;
  cycleTimeMinutes?: number;
  laborHours?: number;
  machineHours?: number;
  machineHourRateId?: string;
  laborHourRateId?: string;
  calculatedCost?: number;
  calculatorMappingId?: string;
  extractedValues?: Record<string, any>;
  notes?: string;
}

export interface UpdateProcessRouteStepRequest {
  processId?: string;
  stepNumber?: number;
  operationName?: string;
  setupTimeMinutes?: number;
  cycleTimeMinutes?: number;
  laborHours?: number;
  machineHours?: number;
  machineHourRateId?: string;
  laborHourRateId?: string;
  calculatedCost?: number;
  calculatorMappingId?: string;
  extractedValues?: Record<string, any>;
  notes?: string;
}

export interface WorkflowTransitionRequest {
  comment?: string;
  role?: UserRole;
}

export interface SaveSessionRequest {
  activeTab: ProcessCategory;
  filters: Record<string, any>;
}

export interface ProcessRoutesFilters {
  bomItemId?: string;
  workflowState?: WorkflowState;
  processGroup?: string;
  processCategory?: string;
  isTemplate?: boolean;
  createdByRole?: UserRole;
  priority?: Priority;
  assignedTo?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// UI State types
export interface ProcessPlanningState {
  activeTab: ProcessCategory;
  selectedRoute?: ProcessRoute;
  expandedRoutes: string[];
  filters: ProcessRoutesFilters;
  isLoading: boolean;
  error?: string;
}

// Category Configuration
export interface CategoryConfig {
  id: ProcessCategory;
  label: string;
  description: string;
  processes: string[];
}

export const PROCESS_CATEGORIES: CategoryConfig[] = [
  {
    id: 'machining',
    label: 'Machining',
    description: 'CNC, Turning, Milling, Drilling',
    processes: ['CNC Milling', 'CNC Turning', 'Drilling', 'Grinding', 'EDM'],
  },
  {
    id: 'sheet_metal',
    label: 'Sheet Metal',
    description: 'Cutting, Bending, Welding',
    processes: ['Laser Cutting', 'Bending', 'Welding', 'Punching', 'Rolling'],
  },
  {
    id: 'assembly',
    label: 'Assembly',
    description: 'Manual, Automated',
    processes: ['Manual Assembly', 'Automated Assembly', 'Testing', 'Quality Control'],
  },
  {
    id: 'plastic_rubber',
    label: 'Plastic Molding',
    description: 'Injection Molding, Extrusion',
    processes: ['Injection Molding', 'Extrusion', 'Blow Molding', 'Thermoforming'],
  },
  {
    id: 'post_processing',
    label: 'Post Processing',
    description: 'Heat Treatment, Surface Finishing, Coating',
    processes: ['Heat Treatment', 'Surface Finishing', 'Coating', 'Painting', 'Plating'],
  },
  {
    id: 'packing_delivery',
    label: 'Packing & Delivery',
    description: 'Packaging, Labeling, Shipping',
    processes: ['Packaging', 'Labeling', 'Shipping', 'Quality Inspection'],
  },
];

// Workflow State Configuration
export interface WorkflowStateConfig {
  id: WorkflowState;
  label: string;
  color: string;
  description: string;
}

export const WORKFLOW_STATES: WorkflowStateConfig[] = [
  {
    id: 'draft',
    label: 'Draft',
    color: 'gray',
    description: 'Route is being created or edited',
  },
  {
    id: 'in_review',
    label: 'In Review',
    color: 'yellow',
    description: 'Route is submitted and awaiting approval',
  },
  {
    id: 'approved',
    label: 'Approved',
    color: 'green',
    description: 'Route has been approved by production manager',
  },
  {
    id: 'active',
    label: 'Active',
    color: 'blue',
    description: 'Route is currently in use for production',
  },
  {
    id: 'archived',
    label: 'Archived',
    color: 'gray',
    description: 'Route is no longer in use',
  },
];

// Helper functions
export function getWorkflowStateConfig(state: WorkflowState): WorkflowStateConfig {
  return WORKFLOW_STATES.find((s) => s.id === state) ?? WORKFLOW_STATES[0]!;
}

export function getCategoryConfig(category: ProcessCategory): CategoryConfig {
  return PROCESS_CATEGORIES.find((c) => c.id === category) ?? PROCESS_CATEGORIES[0]!;
}
