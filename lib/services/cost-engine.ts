/**
 * Manufacturing Cost Calculation Engine
 * Automatically calculates comprehensive cost breakdowns for BOMs and parts
 */

export interface MaterialCost {
  materialType: string;
  unitCost: number;
  quantity: number;
  wastagePercentage: number;
  totalCost: number;
}

export interface ProcessStep {
  stepName: string;
  machineTime: number; // minutes
  laborTime: number; // minutes
  machineRate: number; // per minute
  laborRate: number; // per minute
  setupCost: number;
  toolingCost: number;
  totalCost: number;
}

export interface CostCalculationInput {
  itemId: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  materials: MaterialCost[];
  processes: ProcessStep[];
  packagingCost?: number;
  logisticsCost?: number;
  procuredPartsCost?: number;
  overheadPercentage?: number;
  sgaPercentage?: number;
  profitPercentage?: number;
}

export interface CostCalculationResult {
  itemId: string;
  breakdown: {
    rawMaterialCost: number;
    processCost: number;
    toolingCost: number;
    packagingLogisticsCost: number;
    procuredPartsCost: number;
    overheadCost: number;
    directCost: number;
    sgaCost: number;
    profitAmount: number;
    totalCost: number;
    sellingPrice: number;
  };
  margins: {
    grossMarginAmount: number;
    grossMarginPercentage: number;
    netMarginAmount: number;
    netMarginPercentage: number;
  };
  efficiency: {
    materialEfficiency: number;
    processEfficiency: number;
    overallEfficiency: number;
  };
}

export class CostEngine {
  private static instance: CostEngine;
  
  // Industry standard rates and percentages
  private readonly defaultRates = {
    overheadPercentage: 15.0, // 15% overhead
    sgaPercentage: 12.5, // 12.5% SGA
    profitPercentage: 8.0, // 8% profit margin
    wastagePercentage: 5.0, // 5% material wastage
    machineUtilization: 85.0, // 85% machine utilization
  };

  // Sample material costs database
  private readonly materialDatabase = {
    'mild_steel': { cost: 55.0, unit: 'kg' },
    'stainless_steel': { cost: 120.0, unit: 'kg' },
    'aluminum': { cost: 180.0, unit: 'kg' },
    'brass': { cost: 350.0, unit: 'kg' },
    'plastic_abs': { cost: 80.0, unit: 'kg' },
    'rubber': { cost: 120.0, unit: 'kg' },
  };

  // Sample process rates database
  private readonly processDatabase = {
    'machining': { machineRate: 8.5, laborRate: 4.2 },
    'welding': { machineRate: 6.0, laborRate: 5.5 },
    'assembly': { machineRate: 2.0, laborRate: 3.8 },
    'painting': { machineRate: 4.5, laborRate: 2.5 },
    'quality_check': { machineRate: 1.0, laborRate: 3.0 },
  };

  public static getInstance(): CostEngine {
    if (!CostEngine.instance) {
      CostEngine.instance = new CostEngine();
    }
    return CostEngine.instance;
  }

  /**
   * Calculate comprehensive cost breakdown for a BOM item
   */
  public calculateItemCost(input: CostCalculationInput): CostCalculationResult {
    const materialCost = this.calculateMaterialCost(input.materials);
    const processCost = this.calculateProcessCost(input.processes);
    const packagingLogisticsCost = (input.packagingCost || 0) + (input.logisticsCost || 0);
    const procuredPartsCost = input.procuredPartsCost || 0;
    
    const directCost = materialCost + processCost + packagingLogisticsCost + procuredPartsCost;
    const overheadCost = directCost * (input.overheadPercentage || this.defaultRates.overheadPercentage) / 100;
    const totalManufacturingCost = directCost + overheadCost;
    
    const sgaCost = totalManufacturingCost * (input.sgaPercentage || this.defaultRates.sgaPercentage) / 100;
    const costBeforeProfit = totalManufacturingCost + sgaCost;
    const profitAmount = costBeforeProfit * (input.profitPercentage || this.defaultRates.profitPercentage) / 100;
    const sellingPrice = costBeforeProfit + profitAmount;

    const breakdown = {
      rawMaterialCost: materialCost,
      processCost: processCost,
      packagingLogisticsCost: packagingLogisticsCost,
      procuredPartsCost: procuredPartsCost,
      overheadCost: overheadCost,
      directCost: directCost,
      sgaCost: sgaCost,
      profitAmount: profitAmount,
      totalCost: totalManufacturingCost,
      sellingPrice: sellingPrice,
    };

    const margins = this.calculateMargins(breakdown);
    const efficiency = this.calculateEfficiency(breakdown);

    return {
      itemId: input.itemId,
      breakdown,
      margins,
      efficiency,
    };
  }

  /**
   * Generate sample cost data for demonstration
   */
  public generateSampleCostData(itemType: string = 'assembly'): CostCalculationResult {
    const sampleInput: CostCalculationInput = {
      itemId: 'sample-' + Date.now(),
      itemType: itemType as any,
      quantity: 1,
      materials: [
        {
          materialType: 'mild_steel',
          unitCost: this.materialDatabase.mild_steel.cost,
          quantity: 12.5, // kg
          wastagePercentage: 5.0,
          totalCost: 0, // calculated below
        },
        {
          materialType: 'stainless_steel',
          unitCost: this.materialDatabase.stainless_steel.cost,
          quantity: 3.2, // kg
          wastagePercentage: 3.0,
          totalCost: 0, // calculated below
        },
      ],
      processes: [
        {
          stepName: 'machining',
          machineTime: 45, // minutes
          laborTime: 30, // minutes
          machineRate: this.processDatabase.machining.machineRate,
          laborRate: this.processDatabase.machining.laborRate,
          setupCost: 150,
          toolingCost: 80,
          totalCost: 0, // calculated below
        },
        {
          stepName: 'welding',
          machineTime: 25,
          laborTime: 20,
          machineRate: this.processDatabase.welding.machineRate,
          laborRate: this.processDatabase.welding.laborRate,
          setupCost: 75,
          toolingCost: 40,
          totalCost: 0,
        },
        {
          stepName: 'assembly',
          machineTime: 15,
          laborTime: 35,
          machineRate: this.processDatabase.assembly.machineRate,
          laborRate: this.processDatabase.assembly.laborRate,
          setupCost: 50,
          toolingCost: 25,
          totalCost: 0,
        },
      ],
      packagingCost: 125,
      logisticsCost: 85,
      procuredPartsCost: 340,
      overheadPercentage: 15.0,
      sgaPercentage: 12.5,
      profitPercentage: 8.0,
    };

    return this.calculateItemCost(sampleInput);
  }

  /**
   * Calculate total material cost including wastage
   */
  private calculateMaterialCost(materials: MaterialCost[]): number {
    return materials.reduce((total, material) => {
      const wastageMultiplier = 1 + (material.wastagePercentage / 100);
      const materialCost = material.unitCost * material.quantity * wastageMultiplier;
      material.totalCost = materialCost;
      return total + materialCost;
    }, 0);
  }

  /**
   * Calculate total process cost including all operations
   */
  private calculateProcessCost(processes: ProcessStep[]): number {
    return processes.reduce((total, process) => {
      const machineCost = process.machineTime * process.machineRate;
      const laborCost = process.laborTime * process.laborRate;
      const processCost = machineCost + laborCost + process.setupCost + process.toolingCost;
      process.totalCost = processCost;
      return total + processCost;
    }, 0);
  }

  /**
   * Calculate profit margins
   */
  private calculateMargins(breakdown: any) {
    const grossMarginAmount = breakdown.sellingPrice - breakdown.directCost;
    const grossMarginPercentage = (grossMarginAmount / breakdown.sellingPrice) * 100;
    const netMarginAmount = breakdown.profitAmount;
    const netMarginPercentage = (netMarginAmount / breakdown.sellingPrice) * 100;

    return {
      grossMarginAmount,
      grossMarginPercentage,
      netMarginAmount,
      netMarginPercentage,
    };
  }

  /**
   * Calculate efficiency metrics
   */
  private calculateEfficiency(breakdown: any) {
    const materialEfficiency = (breakdown.rawMaterialCost / breakdown.totalCost) * 100;
    const processEfficiency = (breakdown.processCost / breakdown.totalCost) * 100;
    const overallEfficiency = 100 - ((breakdown.overheadCost + breakdown.sgaCost) / breakdown.totalCost * 100);

    return {
      materialEfficiency,
      processEfficiency,
      overallEfficiency: Math.max(0, overallEfficiency),
    };
  }

  /**
   * Aggregate cost data for multiple items (BOM level)
   */
  public aggregateBomCosts(itemCosts: CostCalculationResult[]) {
    const totals = itemCosts.reduce(
      (acc, item) => ({
        totalRawMaterials: acc.totalRawMaterials + item.breakdown.rawMaterialCost,
        totalProcessCosts: acc.totalProcessCosts + item.breakdown.processCost,
        totalToolingCosts: acc.totalToolingCosts + item.breakdown.toolingCost,
        totalPackagingLogistics: acc.totalPackagingLogistics + item.breakdown.packagingLogisticsCost,
        totalProcuredParts: acc.totalProcuredParts + item.breakdown.procuredPartsCost,
        totalCost: acc.totalCost + item.breakdown.totalCost,
        totalSellingPrice: acc.totalSellingPrice + item.breakdown.sellingPrice,
        totalSgaCost: acc.totalSgaCost + item.breakdown.sgaCost,
        totalProfitAmount: acc.totalProfitAmount + item.breakdown.profitAmount,
      }),
      {
        totalRawMaterials: 0,
        totalProcessCosts: 0,
        totalToolingCosts: 0,
        totalPackagingLogistics: 0,
        totalProcuredParts: 0,
        totalCost: 0,
        totalSellingPrice: 0,
        totalSgaCost: 0,
        totalProfitAmount: 0,
      }
    );

    const averageSgaPercentage = itemCosts.length > 0 
      ? (totals.totalSgaCost / totals.totalCost) * 100 
      : 0;
    
    const averageProfitPercentage = itemCosts.length > 0 
      ? (totals.totalProfitAmount / totals.totalSellingPrice) * 100 
      : 0;

    const totalMargin = totals.totalSellingPrice - totals.totalCost;

    return {
      ...totals,
      averageSgaPercentage,
      averageProfitPercentage,
      totalMargin,
      itemCount: itemCosts.length,
    };
  }
}

// Export singleton instance
export const costEngine = CostEngine.getInstance();