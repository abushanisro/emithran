// Enums and types for remarks system
export enum RemarkType {
  DELAY = 'DELAY',
  QUALITY = 'QUALITY',
  SUGGESTION = 'SUGGESTION',
  SAFETY = 'SAFETY',
  PROCESS = 'PROCESS',
  MATERIAL = 'MATERIAL',
  OTHER = 'OTHER',
}

export enum RemarkPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum RemarkStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum RemarkScope {
  LOT = 'LOT',
  PROCESS = 'PROCESS',
  SUBTASK = 'SUBTASK',
  BOM_PART = 'BOM_PART',
}

// UI display helpers
export const REMARK_TYPE_LABELS: Record<RemarkType, string> = {
  [RemarkType.DELAY]: 'Delay',
  [RemarkType.QUALITY]: 'Quality',
  [RemarkType.SUGGESTION]: 'Suggestion',
  [RemarkType.SAFETY]: 'Safety',
  [RemarkType.PROCESS]: 'Process',
  [RemarkType.MATERIAL]: 'Material',
  [RemarkType.OTHER]: 'Other',
};

export const REMARK_PRIORITY_LABELS: Record<RemarkPriority, string> = {
  [RemarkPriority.LOW]: 'Low',
  [RemarkPriority.MEDIUM]: 'Medium',
  [RemarkPriority.HIGH]: 'High',
  [RemarkPriority.CRITICAL]: 'Critical',
};

export const REMARK_SCOPE_LABELS: Record<RemarkScope, string> = {
  [RemarkScope.LOT]: 'Entire Lot',
  [RemarkScope.PROCESS]: 'Specific Process',
  [RemarkScope.SUBTASK]: 'Specific Subtask',
  [RemarkScope.BOM_PART]: 'Specific BOM Part',
};

// Color schemes for UI
export const REMARK_TYPE_COLORS: Record<RemarkType, string> = {
  [RemarkType.DELAY]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  [RemarkType.QUALITY]: 'bg-blue-100 text-blue-800 border-blue-200',
  [RemarkType.SUGGESTION]: 'bg-green-100 text-green-800 border-green-200',
  [RemarkType.SAFETY]: 'bg-red-100 text-red-800 border-red-200',
  [RemarkType.PROCESS]: 'bg-purple-100 text-purple-800 border-purple-200',
  [RemarkType.MATERIAL]: 'bg-orange-100 text-orange-800 border-orange-200',
  [RemarkType.OTHER]: 'bg-gray-100 text-gray-800 border-gray-200',
};

export const REMARK_PRIORITY_COLORS: Record<RemarkPriority, string> = {
  [RemarkPriority.LOW]: 'bg-gray-100 text-gray-800 border-gray-200',
  [RemarkPriority.MEDIUM]: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  [RemarkPriority.HIGH]: 'bg-orange-100 text-orange-800 border-orange-200',
  [RemarkPriority.CRITICAL]: 'bg-red-100 text-red-800 border-red-200',
};

export const REMARK_STATUS_COLORS: Record<RemarkStatus, string> = {
  [RemarkStatus.OPEN]: 'bg-red-100 text-red-800 border-red-200',
  [RemarkStatus.IN_PROGRESS]: 'bg-blue-100 text-blue-800 border-blue-200',
  [RemarkStatus.RESOLVED]: 'bg-green-100 text-green-800 border-green-200',
  [RemarkStatus.CLOSED]: 'bg-gray-100 text-gray-800 border-gray-200',
};

// Form validation helpers
export const REMARK_TYPE_OPTIONS = Object.values(RemarkType).map(type => ({
  value: type,
  label: REMARK_TYPE_LABELS[type],
}));

export const REMARK_PRIORITY_OPTIONS = Object.values(RemarkPriority).map(priority => ({
  value: priority,
  label: REMARK_PRIORITY_LABELS[priority],
}));

export const REMARK_SCOPE_OPTIONS = Object.values(RemarkScope).map(scope => ({
  value: scope,
  label: REMARK_SCOPE_LABELS[scope],
}));

// Utility functions
export function getRemarkTypeColor(type: RemarkType): string {
  return REMARK_TYPE_COLORS[type] || REMARK_TYPE_COLORS[RemarkType.OTHER];
}

export function getRemarkPriorityColor(priority: RemarkPriority): string {
  return REMARK_PRIORITY_COLORS[priority] || REMARK_PRIORITY_COLORS[RemarkPriority.LOW];
}

export function getRemarkStatusColor(status: RemarkStatus): string {
  return REMARK_STATUS_COLORS[status] || REMARK_STATUS_COLORS[RemarkStatus.OPEN];
}
