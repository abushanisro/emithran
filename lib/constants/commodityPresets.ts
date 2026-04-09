/**
 * Commodity-specific presets for MHR calculations
 * These values are industry-standard defaults that auto-populate based on commodity selection
 */

import type { CreateMHRData } from '@/lib/api/mhr';

export type CommodityPreset = Omit<CreateMHRData, 'machineName' | 'location' | 'commodityCode' | 'machineDescription' | 'manufacturer' | 'model' | 'specification' | 'landedMachineCost' | 'machineFootprintSqm' | 'rentPerSqmPerMonth' | 'powerKwhPerHour' | 'electricityCostPerKwh'>;

export interface CommodityOption {
  value: string;
  label: string;
  description: string;
  preset: CommodityPreset;
}

export const COMMODITY_PRESETS: CommodityOption[] = [
  // Process Group: Plastic & Rubber
  {
    value: 'plastic-rubber',
    label: 'Plastic & Rubber',
    description: 'Injection molding, extrusion, blow molding, rubber processing',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 120.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 8.00,
      installationCostPercentage: 20.00,
      paybackPeriodYears: 8.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 7.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 15.00,
    },
  },
  {
    value: 'metal-fabrication',
    label: 'Metal Fabrication',
    description: 'Sheet metal, structural steel, metal assembly operations',
    preset: {
      shiftsPerDay: 2.50,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 160.00,
      capacityUtilizationRate: 80.00,
      accessoriesCostPercentage: 12.00,
      installationCostPercentage: 25.00,
      paybackPeriodYears: 10.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.20,
      maintenanceCostPercentage: 8.00,
      adminOverheadPercentage: 10.00,
      profitMarginPercentage: 18.00,
    },
  },
  {
    value: 'electronics-assembly',
    label: 'Electronics & Assembly',
    description: 'SMT lines, PCB assembly, electronics testing equipment',
    preset: {
      shiftsPerDay: 2.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 80.00,
      capacityUtilizationRate: 90.00,
      accessoriesCostPercentage: 10.00,
      installationCostPercentage: 15.00,
      paybackPeriodYears: 7.00,
      interestRatePercentage: 8.50,
      insuranceRatePercentage: 1.00,
      maintenanceCostPercentage: 5.00,
      adminOverheadPercentage: 15.00,
      profitMarginPercentage: 20.00,
    },
  },
  {
    value: 'automotive',
    label: 'Automotive',
    description: 'Assembly lines, welding robots, painting booths, testing',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 200.00,
      capacityUtilizationRate: 90.00,
      accessoriesCostPercentage: 15.00,
      installationCostPercentage: 30.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 8.00,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 9.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 15.00,
    },
  },
  {
    value: 'textile-garment',
    label: 'Textile & Garment',
    description: 'Weaving, knitting, dyeing, cutting, sewing operations',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 100.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 5.00,
      installationCostPercentage: 10.00,
      paybackPeriodYears: 8.00,
      interestRatePercentage: 9.50,
      insuranceRatePercentage: 1.00,
      maintenanceCostPercentage: 6.00,
      adminOverheadPercentage: 10.00,
      profitMarginPercentage: 12.00,
    },
  },
  {
    value: 'food-beverage',
    label: 'Food & Beverage',
    description: 'Processing, packaging, bottling, pasteurization',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 300.00,
      plannedMaintenanceHoursPerYear: 180.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 10.00,
      installationCostPercentage: 25.00,
      paybackPeriodYears: 10.00,
      interestRatePercentage: 8.50,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 8.00,
      adminOverheadPercentage: 15.00,
      profitMarginPercentage: 18.00,
    },
  },
  {
    value: 'pharmaceutical',
    label: 'Pharmaceutical',
    description: 'Tablet press, coating, mixing, clean room packaging',
    preset: {
      shiftsPerDay: 2.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 150.00,
      capacityUtilizationRate: 80.00,
      accessoriesCostPercentage: 12.00,
      installationCostPercentage: 35.00,
      paybackPeriodYears: 10.00,
      interestRatePercentage: 8.00,
      insuranceRatePercentage: 1.20,
      maintenanceCostPercentage: 7.00,
      adminOverheadPercentage: 18.00,
      profitMarginPercentage: 25.00,
    },
  },
  {
    value: 'chemical-processing',
    label: 'Chemical Processing',
    description: 'Reactors, mixers, distillation, filtration systems',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 330.00,
      plannedMaintenanceHoursPerYear: 240.00,
      capacityUtilizationRate: 90.00,
      accessoriesCostPercentage: 15.00,
      installationCostPercentage: 40.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 8.00,
      insuranceRatePercentage: 2.00,
      maintenanceCostPercentage: 10.00,
      adminOverheadPercentage: 15.00,
      profitMarginPercentage: 20.00,
    },
  },
  {
    value: 'printing-packaging',
    label: 'Printing & Packaging',
    description: 'Offset printing, flexo, die-cutting, laminating machines',
    preset: {
      shiftsPerDay: 2.50,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 120.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 8.00,
      installationCostPercentage: 15.00,
      paybackPeriodYears: 8.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.00,
      maintenanceCostPercentage: 6.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 16.00,
    },
  },
  {
    value: 'wood-furniture',
    label: 'Wood & Furniture',
    description: 'CNC routers, saws, edge banding, spray booths',
    preset: {
      shiftsPerDay: 2.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 100.00,
      capacityUtilizationRate: 75.00,
      accessoriesCostPercentage: 10.00,
      installationCostPercentage: 15.00,
      paybackPeriodYears: 9.00,
      interestRatePercentage: 9.50,
      insuranceRatePercentage: 1.00,
      maintenanceCostPercentage: 6.00,
      adminOverheadPercentage: 10.00,
      profitMarginPercentage: 14.00,
    },
  },
  {
    value: 'glass-ceramics',
    label: 'Glass & Ceramics',
    description: 'Furnaces, kilns, molding, cutting, polishing equipment',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 300.00,
      plannedMaintenanceHoursPerYear: 200.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 12.00,
      installationCostPercentage: 30.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 8.50,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 9.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 15.00,
    },
  },
  {
    value: 'paper-pulp',
    label: 'Paper & Pulp',
    description: 'Paper machines, pulping, converting, tissue making',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 330.00,
      plannedMaintenanceHoursPerYear: 220.00,
      capacityUtilizationRate: 90.00,
      accessoriesCostPercentage: 12.00,
      installationCostPercentage: 30.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 8.50,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 9.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 14.00,
    },
  },
  {
    value: 'rubber-tire',
    label: 'Rubber & Tire',
    description: 'Tire building, vulcanizing, rubber mixing, molding',
    preset: {
      shiftsPerDay: 3.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 300.00,
      plannedMaintenanceHoursPerYear: 180.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 12.00,
      installationCostPercentage: 25.00,
      paybackPeriodYears: 10.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 8.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 16.00,
    },
  },
  {
    value: 'aerospace',
    label: 'Aerospace',
    description: 'Precision machining, composite forming, assembly systems',
    preset: {
      shiftsPerDay: 2.00,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 160.00,
      capacityUtilizationRate: 80.00,
      accessoriesCostPercentage: 15.00,
      installationCostPercentage: 30.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 8.00,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 8.00,
      adminOverheadPercentage: 15.00,
      profitMarginPercentage: 25.00,
    },
  },
  {
    value: 'construction-equipment',
    label: 'Construction Equipment',
    description: 'Heavy machinery, earth moving, concrete equipment',
    preset: {
      shiftsPerDay: 2.50,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 200.00,
      capacityUtilizationRate: 75.00,
      accessoriesCostPercentage: 15.00,
      installationCostPercentage: 25.00,
      paybackPeriodYears: 12.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.50,
      maintenanceCostPercentage: 9.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 18.00,
    },
  },
  {
    value: 'general-purpose',
    label: 'General Purpose',
    description: 'Custom or multi-purpose machinery',
    preset: {
      shiftsPerDay: 2.50,
      hoursPerShift: 8.00,
      workingDaysPerYear: 260.00,
      plannedMaintenanceHoursPerYear: 120.00,
      capacityUtilizationRate: 85.00,
      accessoriesCostPercentage: 10.00,
      installationCostPercentage: 20.00,
      paybackPeriodYears: 10.00,
      interestRatePercentage: 9.00,
      insuranceRatePercentage: 1.20,
      maintenanceCostPercentage: 7.00,
      adminOverheadPercentage: 12.00,
      profitMarginPercentage: 15.00,
    },
  },
];

/**
 * Manufacturing Process Options
 * Separate from commodity codes - represents the specific manufacturing process/operation
 */
export interface ManufacturingProcessOption {
  value: string;
  label: string;
  description: string;
}

export const MANUFACTURING_PROCESSES: ManufacturingProcessOption[] = [
  {
    value: 'bending',
    label: 'Bending',
    description: 'Sheet metal bending machines, press brakes, folding equipment',
  },
  {
    value: 'casting',
    label: 'Casting',
    description: 'Die casting, sand casting, investment casting equipment',
  },
  {
    value: 'cnc-machine',
    label: 'CNC Machine',
    description: 'CNC milling, turning, machining centers, multi-axis machines',
  },
  {
    value: 'cutting',
    label: 'Cutting',
    description: 'Laser cutting, plasma cutting, water jet, shearing machines',
  },
  {
    value: 'fabrication',
    label: 'Fabrication',
    description: 'Metal fabrication, welding, assembly, structural work',
  },
  {
    value: 'finishing-options',
    label: 'Finishing Options',
    description: 'Surface finishing, coating, painting, polishing equipment',
  },
  {
    value: 'forging',
    label: 'Forging',
    description: 'Hot forging, cold forging, drop hammers, press forging',
  },
  {
    value: 'forming',
    label: 'Forming',
    description: 'Metal forming, stamping, deep drawing, roll forming machines',
  },
  {
    value: 'grinding',
    label: 'Grinding',
    description: 'Surface grinding, cylindrical grinding, tool & cutter grinding',
  },
  {
    value: 'heat-treatment',
    label: 'Heat Treatment',
    description: 'Annealing, hardening, tempering, case hardening furnaces',
  },
  {
    value: 'heating-furnace',
    label: 'Heating Furnace',
    description: 'Industrial furnaces, melting, heating, thermal processing',
  },
  {
    value: 'injection-molding',
    label: 'Injection Molding',
    description: 'Plastic injection molding machines, mold making equipment',
  },
  {
    value: 'material-handling',
    label: 'Material Handling',
    description: 'Conveyors, cranes, hoists, forklifts, automated handling systems',
  },
  {
    value: 'melting-furnace',
    label: 'Melting Furnace',
    description: 'Metal melting, induction furnace, arc furnace, foundry equipment',
  },
  {
    value: 'raw-material',
    label: 'Raw Material',
    description: 'Raw material processing, preparation, storage equipment',
  },
  {
    value: 'shearing',
    label: 'Shearing',
    description: 'Shearing machines, guillotine shears, hydraulic shears',
  },
  {
    value: 'welding',
    label: 'Welding',
    description: 'Arc welding, MIG/TIG welding, spot welding, automated welding',
  },
];

/**
 * Get manufacturing process label from value
 */
export function getManufacturingProcessLabel(processValue: string): string {
  const process = MANUFACTURING_PROCESSES.find(p => p.value === processValue);
  return process?.label || processValue;
}

/**
 * Get preset by commodity value
 */
export function getCommodityPreset(commodityValue: string): CommodityPreset | null {
  const commodity = COMMODITY_PRESETS.find(c => c.value === commodityValue);
  return commodity?.preset || null;
}

/**
 * Get default commodity (Plastic & Rubber)
 */
export function getDefaultCommodity(): CommodityOption {
  return COMMODITY_PRESETS[0]!;
}

/**
 * Get commodity label from value
 */
export function getCommodityLabel(commodityValue: string): string {
  const commodity = COMMODITY_PRESETS.find(c => c.value === commodityValue);
  return commodity?.label || commodityValue;
}
