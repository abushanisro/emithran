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

  // Operational Parameters
  shiftsPerDay: z.number()
    .min(0.5, 'Shifts per day must be at least 0.5')
    .max(4, 'Shifts per day cannot exceed 4'),

  hoursPerShift: z.number()
    .min(1, 'Hours per shift must be at least 1')
    .max(24, 'Hours per shift cannot exceed 24'),

  workingDaysPerYear: z.number()
    .min(200, 'Working days must be at least 200 per year')
    .max(365, 'Working days cannot exceed 365 per year'),

  plannedMaintenanceHoursPerYear: z.number()
    .min(0, 'Maintenance hours cannot be negative')
    .max(8760, 'Maintenance hours cannot exceed total hours in a year'),

  capacityUtilizationRate: z.number()
    .min(50, 'Capacity utilization must be at least 50%')
    .max(100, 'Capacity utilization cannot exceed 100%'),

  // Capital & Financial Parameters
  landedMachineCost: z.number()
    .positive('Landed machine cost must be greater than zero')
    .max(1000000000, 'Landed machine cost seems unreasonably high'),

  accessoriesCostPercentage: z.number()
    .min(0, 'Accessories cost cannot be negative')
    .max(50, 'Accessories cost cannot exceed 50% of machine cost'),

  installationCostPercentage: z.number()
    .min(10, 'Installation cost must be at least 10%')
    .max(40, 'Installation cost cannot exceed 40%'),

  paybackPeriodYears: z.number()
    .min(1, 'Payback period must be at least 1 year')
    .max(30, 'Payback period cannot exceed 30 years'),

  interestRatePercentage: z.number()
    .min(0, 'Interest rate cannot be negative')
    .max(30, 'Interest rate cannot exceed 30%'),

  insuranceRatePercentage: z.number()
    .min(0, 'Insurance rate cannot be negative')
    .max(10, 'Insurance rate cannot exceed 10%'),

  maintenanceCostPercentage: z.number()
    .min(0, 'Maintenance cost cannot be negative')
    .max(20, 'Maintenance cost cannot exceed 20%'),

  // Physical & Utility Parameters
  machineFootprintSqm: z.number()
    .min(0, 'Machine footprint cannot be negative')
    .max(10000, 'Machine footprint seems unreasonably large'),

  rentPerSqmPerMonth: z.number()
    .min(0, 'Rent cannot be negative')
    .max(100000, 'Rent per sqm seems unreasonably high'),

  powerKwhPerHour: z.number()
    .min(0, 'Power consumption cannot be negative')
    .max(10000, 'Power consumption seems unreasonably high'),

  electricityCostPerKwh: z.number()
    .min(0, 'Electricity cost cannot be negative')
    .max(100, 'Electricity cost seems unreasonably high'),

  // Margins
  adminOverheadPercentage: z.number()
    .min(0, 'Admin overhead cannot be negative')
    .max(50, 'Admin overhead cannot exceed 50%'),

  profitMarginPercentage: z.number()
    .min(0, 'Profit margin cannot be negative')
    .max(100, 'Profit margin cannot exceed 100%'),

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
}).refine(
  (data) => {
    // Validate that combined percentage costs don't exceed reasonable limits
    const totalPercentages =
      data.accessoriesCostPercentage +
      data.installationCostPercentage +
      data.interestRatePercentage +
      data.insuranceRatePercentage +
      data.maintenanceCostPercentage +
      data.adminOverheadPercentage +
      data.profitMarginPercentage;

    return totalPercentages <= 150;
  },
  {
    message: 'Combined cost percentages exceed reasonable limits (>150%). Please review your percentages.',
    path: ['installationCostPercentage'],
  }
).refine(
  (data) => {
    // Validate that maintenance hours don't exceed available hours
    const maxAvailableHours = data.shiftsPerDay * data.hoursPerShift * data.workingDaysPerYear;
    return data.plannedMaintenanceHoursPerYear <= maxAvailableHours * 0.3; // Max 30% maintenance
  },
  {
    message: 'Maintenance hours cannot exceed 30% of total working hours',
    path: ['plannedMaintenanceHoursPerYear'],
  }
);

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
