import { z } from 'zod';

/**
 * MHR Form Validation Schema
 * Implements comprehensive business rules and constraints for Machine Hour Rate calculations
 */
export const mhrFormSchema = z.object({
  // Basic Information
  machineName: z.string()
    .min(1, 'Machine name is required')
    .max(100, 'Machine name must be less than 100 characters'),

  location: z.string()
    .min(1, 'Location is required')
    .max(100, 'Location must be less than 100 characters'),

  commodityCode: z.string()
    .min(1, 'Commodity code is required'),

  machineDescription: z.string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .or(z.literal('')),

  manufacturer: z.string()
    .max(100, 'Manufacturer must be less than 100 characters')
    .optional()
    .or(z.literal('')),

  model: z.string()
    .max(50, 'Model must be less than 50 characters')
    .optional()
    .or(z.literal('')),

  specification: z.string()
    .optional()
    .or(z.literal('')),

  // Operational Parameters — the detailed capex-amortization calculator these
  // once drove (Operation/Costs/Utilities/Margins tabs) was removed in favor
  // of Manual MHR Entry as the only machine-rate input path (see
  // MHRFormDialog.tsx); kept optional, not deleted, only for legacy records
  // that still carry a value from before that change.
  shiftsPerDay: z.number()
    .min(0.5, 'Shifts per day must be at least 0.5')
    .max(4, 'Shifts per day cannot exceed 4')
    .optional(),

  hoursPerShift: z.number()
    .min(1, 'Hours per shift must be at least 1')
    .max(24, 'Hours per shift cannot exceed 24')
    .optional(),

  workingDaysPerYear: z.number()
    .min(200, 'Working days must be at least 200 per year')
    .max(365, 'Working days cannot exceed 365 per year')
    .optional(),

  plannedMaintenanceHoursPerYear: z.number()
    .min(0, 'Maintenance hours cannot be negative')
    .max(8760, 'Maintenance hours cannot exceed total hours in a year')
    .optional(),

  capacityUtilizationRate: z.number()
    .min(50, 'Capacity utilization must be at least 50%')
    .max(100, 'Capacity utilization cannot exceed 100%')
    .optional(),

  // Capital & Financial Parameters
  landedMachineCost: z.number()
    .positive('Landed machine cost must be greater than zero')
    .max(1000000000, 'Landed machine cost seems unreasonably high')
    .optional(),

  accessoriesCostPercentage: z.number()
    .min(0, 'Accessories cost cannot be negative')
    .max(50, 'Accessories cost cannot exceed 50% of machine cost')
    .optional(),

  installationCostPercentage: z.number()
    .min(10, 'Installation cost must be at least 10%')
    .max(40, 'Installation cost cannot exceed 40%')
    .optional(),

  paybackPeriodYears: z.number()
    .min(1, 'Payback period must be at least 1 year')
    .max(30, 'Payback period cannot exceed 30 years')
    .optional(),

  interestRatePercentage: z.number()
    .min(0, 'Interest rate cannot be negative')
    .max(30, 'Interest rate cannot exceed 30%')
    .optional(),

  insuranceRatePercentage: z.number()
    .min(0, 'Insurance rate cannot be negative')
    .max(10, 'Insurance rate cannot exceed 10%')
    .optional(),

  maintenanceCostPercentage: z.number()
    .min(0, 'Maintenance cost cannot be negative')
    .max(20, 'Maintenance cost cannot exceed 20%')
    .optional(),

  // Physical & Utility Parameters
  machineFootprintSqm: z.number()
    .min(0, 'Machine footprint cannot be negative')
    .max(10000, 'Machine footprint seems unreasonably large')
    .optional(),

  rentPerSqmPerMonth: z.number()
    .min(0, 'Rent cannot be negative')
    .max(100000, 'Rent per sqm seems unreasonably high')
    .optional(),

  powerKwhPerHour: z.number()
    .min(0, 'Power consumption cannot be negative')
    .max(10000, 'Power consumption seems unreasonably high')
    .optional(),

  electricityCostPerKwh: z.number()
    .min(0, 'Electricity cost cannot be negative')
    .max(100, 'Electricity cost seems unreasonably high')
    .optional(),

  // Margins
  adminOverheadPercentage: z.number()
    .min(0, 'Admin overhead cannot be negative')
    .max(50, 'Admin overhead cannot exceed 50%')
    .optional(),

  profitMarginPercentage: z.number()
    .min(0, 'Profit margin cannot be negative')
    .max(100, 'Profit margin cannot exceed 100%')
    .optional(),

  // India 2026 extended fields (all optional)
  machineClass: z.string().optional().or(z.literal('')),
  automationLevel: z.string().optional().or(z.literal('')),
  wageGrade: z.string().optional().or(z.literal('')),
  operators: z.number().min(0).optional(),
  machinePriceUsd: z.number().min(0).optional(),
  manufacturerCountry: z.string().optional().or(z.literal('')),
  setupTimeHr: z.number().min(0).optional(),
  lhrInrPerHr: z.number().min(0).optional(),
  usdLaborRatePerHr: z.number().min(0).optional(),
  usdLhrBase: z.number().min(0).optional(),
  usdLhrBurden: z.number().min(0).optional(),
  usdLhrTotal: z.number().min(0).optional(),
  directOverheadRate: z.number().min(0).optional(),
  indirectOverheadRate: z.number().min(0).optional(),

  // Machine capability (migration 324/339) — the same real fields
  // machine-selection/selector.ts reads for ranking, previously settable only
  // via Excel import or a raw SQL migration, never through this dialog.
  maxXMm: z.number().min(0).optional(),
  maxYMm: z.number().min(0).optional(),
  maxZMm: z.number().min(0).optional(),
  maxDiameterMm: z.number().min(0).optional(),
  maxLengthMm: z.number().min(0).optional(),
  maxTonnage: z.number().min(0).optional(),
  maxThicknessMm: z.number().min(0).optional(),
  maxWorkpieceWeightKg: z.number().min(0).optional(),
  powerKw: z.number().min(0).optional(),
  maxThicknessMsMm: z.number().min(0).optional(),
  maxThicknessSsMm: z.number().min(0).optional(),
  maxThicknessAlMm: z.number().min(0).optional(),
  maxThicknessCuMm: z.number().min(0).optional(),
  cuttableMaterials: z.string().optional().or(z.literal('')),
});

export type MHRFormData = z.infer<typeof mhrFormSchema>;

/**
 * Helper function to get user-friendly error messages
 */
export function getMHRValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unknown validation error occurred';
}
