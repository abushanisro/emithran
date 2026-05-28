/**
 * Shared BOM types and enums
 * Single source of truth for BOM-related type definitions
 */

export enum BOMItemType {
  ASSEMBLY = 'assembly',
  SUB_ASSEMBLY = 'sub_assembly',
  CHILD_PART = 'child_part',
}

export const ITEM_TYPE_LABELS: Record<BOMItemType, string> = {
  [BOMItemType.ASSEMBLY]: 'L0 — Assembly',
  [BOMItemType.SUB_ASSEMBLY]: 'L1 — Sub-Assembly',
  [BOMItemType.CHILD_PART]: 'L2 — Component / Child Part',
};
