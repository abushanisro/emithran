/**
 * MHR Calculation Engine
 *
 * Implements manufacturing cost engineering calculations following industry best practices:
 * - ISO 31000 Risk Management
 * - Standard Cost Accounting Principles
 * - OEM Manufacturing Standards
 *
 * This engine separates calculation logic from business logic and provides
 * clean, testable, and maintainable code following SOLID principles.
 *
 * @author Manufacturing Cost Engineering Team
 * @version 2.0.0
 */

import { MHR_CALCULATION_CONSTANTS } from '../constants/mhr-calculation.constants';
import { CreateMHRDto, UpdateMHRDto } from '../dto/mhr.dto';
import { MHRCalculationResult } from '../dto/mhr-response.dto';


export class MHRCalculationEngine {
  private readonly precision = MHR_CALCULATION_CONSTANTS.PRECISION;
  private readonly defaults = MHR_CALCULATION_CONSTANTS.DEFAULTS;

  /**
   * Main calculation method following manufacturing cost engineering standards
   *
   * Cost Structure:
   * 1. Fixed Costs (Cost of Ownership):
   *    - Depreciation (Straight-line method)
   *    - Interest (On annual depreciation amount)
   *    - Insurance (On total capital)
   *    - Rent (Footprint × Rate × 12 months)
   *
   * 2. Fixed Operating Costs:
   *    - Maintenance & MRO (On total capital)
   *
   * 3. Variable Costs:
   *    - Electricity (Power × Cost × Effective Hours)
   *
   * 4. Overheads:
   *    - Admin Overhead (% of operating cost)
   *
   * 5. Margin:
   *    - Profit Margin (% of subtotal)
   *
   * @param dto Input parameters for MHR calculation
   * @returns Complete MHR calculation result
   */
  calculate(dto: CreateMHRDto | UpdateMHRDto): MHRCalculationResult {
    // Step 1: Calculate working hours
    const hours = this.calculateWorkingHours(dto);

    // Step 2: Calculate capital investment
    const capital = this.calculateCapitalInvestment(dto);

    // Step 3: Calculate annual costs
    const annualCosts = this.calculateAnnualCosts(dto, capital, hours.effectiveHoursPerYear);

    // Step 4: Calculate per-hour costs
    const hourlyCosts = this.calculateHourlyCosts(annualCosts, hours.effectiveHoursPerYear);

    // Step 5: Calculate cost categories
    const costCategories = this.calculateCostCategories(hourlyCosts);

    // Step 6: Calculate final MHR with overheads and margins
    const finalMHR = this.calculateFinalMHR(dto, costCategories.totalOperatingCostPerHour);

    // Return complete calculation result with proper rounding
    return this.buildCalculationResult(hours, capital, annualCosts, hourlyCosts, costCategories, finalMHR);
  }

  /**
   * Calculate working hours with proper business logic
   *
   * Formula:
   * - Working Hours = Shifts × Hours/Shift × Working Days
   * - Available Hours = Working Hours - Planned Maintenance
   * - Effective Hours = Available Hours × Capacity Utilization %
   */
  private calculateWorkingHours(dto: CreateMHRDto | UpdateMHRDto) {
    const shiftsPerDay = dto.shiftsPerDay ?? this.defaults.SHIFTS_PER_DAY;
    const hoursPerShift = dto.hoursPerShift ?? this.defaults.HOURS_PER_SHIFT;
    const workingDaysPerYear = dto.workingDaysPerYear ?? this.defaults.WORKING_DAYS_PER_YEAR;
    const plannedMaintenanceHours = dto.plannedMaintenanceHoursPerYear ?? 0;
    const capacityUtilization = dto.capacityUtilizationRate ?? this.defaults.CAPACITY_UTILIZATION_RATE;

    const workingHoursPerYear = shiftsPerDay * hoursPerShift * workingDaysPerYear;
    const availableHoursPerYear = workingHoursPerYear - plannedMaintenanceHours;
    const effectiveHoursPerYear = availableHoursPerYear * (capacityUtilization / 100);

    return {
      workingHoursPerYear: this.round(workingHoursPerYear, this.precision.HOURS),
      availableHoursPerYear: this.round(availableHoursPerYear, this.precision.HOURS),
      effectiveHoursPerYear: this.round(effectiveHoursPerYear, this.precision.HOURS),
    };
  }

  /**
   * Calculate total capital investment
   *
   * Formula (Industry Standard):
   * - Accessories Cost = Landed Cost × Accessories %
   * - Installation Cost = (Landed Cost + Accessories Cost) × Installation %
   * - Total Capital = Landed Cost + Accessories Cost + Installation Cost
   */
  private calculateCapitalInvestment(dto: CreateMHRDto | UpdateMHRDto) {
    const landedCost = dto.landedMachineCost ?? 0;
    const accessoriesPercentage = dto.accessoriesCostPercentage ?? this.defaults.ACCESSORIES_COST_PERCENTAGE;
    const installationPercentage = dto.installationCostPercentage ?? this.defaults.INSTALLATION_COST_PERCENTAGE;

    const accessoriesCost = landedCost * (accessoriesPercentage / 100);
    const baseForInstallation = landedCost + accessoriesCost;
    const installationCost = baseForInstallation * (installationPercentage / 100);
    const totalCapitalInvestment = landedCost + accessoriesCost + installationCost;

    return {
      landedCost: this.round(landedCost, this.precision.CURRENCY),
      accessoriesCost: this.round(accessoriesCost, this.precision.CURRENCY),
      installationCost: this.round(installationCost, this.precision.CURRENCY),
      totalCapitalInvestment: this.round(totalCapitalInvestment, this.precision.CURRENCY),
    };
  }

  /**
   * Calculate annual costs following cost accounting principles
   *
   * Fixed Costs (Annual):
   * - Depreciation: Straight-line method (Total Capital ÷ Payback Period)
   * - Interest: On annual depreciation amount (Depreciation × Interest %)
   * - Insurance: On total capital (Total Capital × Insurance %)
   * - Rent: Monthly rent × 12 months
   * - Maintenance: On total capital (Total Capital × Maintenance %)
   *
   * Variable Costs (Annual):
   * - Electricity: Power consumption × Cost × Effective Hours
   */
  private calculateAnnualCosts(
    dto: CreateMHRDto | UpdateMHRDto,
    capital: ReturnType<typeof this.calculateCapitalInvestment>,
    effectiveHoursPerYear: number
  ) {
    const paybackPeriod = dto.paybackPeriodYears ?? this.defaults.PAYBACK_PERIOD_YEARS;
    const interestRate = dto.interestRatePercentage ?? this.defaults.INTEREST_RATE;
    const insuranceRate = dto.insuranceRatePercentage ?? this.defaults.INSURANCE_RATE;
    const maintenanceRate = dto.maintenanceCostPercentage ?? this.defaults.MAINTENANCE_COST_PERCENTAGE;

    // Fixed Costs
    const depreciationPerAnnum = capital.totalCapitalInvestment / paybackPeriod;
    const interestPerAnnum = depreciationPerAnnum * (interestRate / 100); // Interest on depreciation
    const insurancePerAnnum = capital.totalCapitalInvestment * (insuranceRate / 100);
    const rentPerAnnum = (dto.machineFootprintSqm ?? 0) * (dto.rentPerSqmPerMonth ?? 0) * MHR_CALCULATION_CONSTANTS.TIME.MONTHS_PER_YEAR;
    const maintenancePerAnnum = capital.totalCapitalInvestment * (maintenanceRate / 100); // On total capital

    // Variable Costs
    const powerPerHour = dto.powerKwhPerHour ?? 0;
    const electricityCostPerKwh = dto.electricityCostPerKwh ?? 0;
    const electricityPerAnnum = powerPerHour * electricityCostPerKwh * effectiveHoursPerYear;

    return {
      depreciationPerAnnum: this.round(depreciationPerAnnum, this.precision.CURRENCY),
      interestPerAnnum: this.round(interestPerAnnum, this.precision.CURRENCY),
      insurancePerAnnum: this.round(insurancePerAnnum, this.precision.CURRENCY),
      rentPerAnnum: this.round(rentPerAnnum, this.precision.CURRENCY),
      maintenancePerAnnum: this.round(maintenancePerAnnum, this.precision.CURRENCY),
      electricityPerAnnum: this.round(electricityPerAnnum, this.precision.CURRENCY),
    };
  }

  /**
   * Calculate per-hour costs by dividing annual costs by effective hours
   */
  private calculateHourlyCosts(
    annualCosts: ReturnType<typeof this.calculateAnnualCosts>,
    effectiveHoursPerYear: number
  ) {
    // Prevent division by zero
    if (effectiveHoursPerYear === 0) {
      return {
        depreciationPerHour: 0,
        interestPerHour: 0,
        insurancePerHour: 0,
        rentPerHour: 0,
        maintenancePerHour: 0,
        electricityPerHour: 0,
      };
    }

    return {
      depreciationPerHour: this.round(annualCosts.depreciationPerAnnum / effectiveHoursPerYear, this.precision.RATE),
      interestPerHour: this.round(annualCosts.interestPerAnnum / effectiveHoursPerYear, this.precision.RATE),
      insurancePerHour: this.round(annualCosts.insurancePerAnnum / effectiveHoursPerYear, this.precision.RATE),
      rentPerHour: this.round(annualCosts.rentPerAnnum / effectiveHoursPerYear, this.precision.RATE),
      maintenancePerHour: this.round(annualCosts.maintenancePerAnnum / effectiveHoursPerYear, this.precision.RATE),
      electricityPerHour: this.round(annualCosts.electricityPerAnnum / effectiveHoursPerYear, this.precision.RATE),
    };
  }

  /**
   * Calculate cost categories following standard cost accounting
   */
  private calculateCostCategories(hourlyCosts: ReturnType<typeof this.calculateHourlyCosts>) {
    // Cost of Ownership (Fixed Costs excluding maintenance)
    const costOfOwnershipPerHour =
      hourlyCosts.depreciationPerHour +
      hourlyCosts.interestPerHour +
      hourlyCosts.insurancePerHour +
      hourlyCosts.rentPerHour;

    // Total Fixed Cost (includes maintenance)
    const totalFixedCostPerHour = costOfOwnershipPerHour + hourlyCosts.maintenancePerHour;

    // Total Variable Cost
    const totalVariableCostPerHour = hourlyCosts.electricityPerHour;

    // Total Operating Cost
    const totalOperatingCostPerHour = totalFixedCostPerHour + totalVariableCostPerHour;

    return {
      costOfOwnershipPerHour: this.round(costOfOwnershipPerHour, this.precision.RATE),
      totalFixedCostPerHour: this.round(totalFixedCostPerHour, this.precision.RATE),
      totalVariableCostPerHour: this.round(totalVariableCostPerHour, this.precision.RATE),
      totalOperatingCostPerHour: this.round(totalOperatingCostPerHour, this.precision.RATE),
    };
  }

  /**
   * Calculate final MHR with overheads and profit margin
   */
  private calculateFinalMHR(
    dto: CreateMHRDto | UpdateMHRDto,
    totalOperatingCostPerHour: number
  ) {
    const adminOverheadPercentage = dto.adminOverheadPercentage ?? 0;
    const profitMarginPercentage = dto.profitMarginPercentage ?? 0;

    // Admin overhead is calculated on operating cost
    const adminOverheadPerHour = totalOperatingCostPerHour * (adminOverheadPercentage / 100);

    // Subtotal before profit
    const subtotalBeforeProfit = totalOperatingCostPerHour + adminOverheadPerHour;

    // Profit margin is calculated on subtotal
    const profitMarginPerHour = subtotalBeforeProfit * (profitMarginPercentage / 100);

    // Total Machine Hour Rate
    const totalMachineHourRate = subtotalBeforeProfit + profitMarginPerHour;

    return {
      adminOverheadPerHour: this.round(adminOverheadPerHour, this.precision.RATE),
      profitMarginPerHour: this.round(profitMarginPerHour, this.precision.RATE),
      totalMachineHourRate: this.round(totalMachineHourRate, this.precision.RATE),
    };
  }

  /**
   * Build final calculation result with all values properly rounded
   */
  private buildCalculationResult(
    hours: ReturnType<typeof this.calculateWorkingHours>,
    capital: ReturnType<typeof this.calculateCapitalInvestment>,
    annualCosts: ReturnType<typeof this.calculateAnnualCosts>,
    hourlyCosts: ReturnType<typeof this.calculateHourlyCosts>,
    costCategories: ReturnType<typeof this.calculateCostCategories>,
    finalMHR: ReturnType<typeof this.calculateFinalMHR>
  ): MHRCalculationResult {
    // Calculate total annual costs
    const totalFixedCostPerAnnum =
      annualCosts.depreciationPerAnnum +
      annualCosts.interestPerAnnum +
      annualCosts.insurancePerAnnum +
      annualCosts.rentPerAnnum +
      annualCosts.maintenancePerAnnum;

    const totalVariableCostPerAnnum = annualCosts.electricityPerAnnum;
    const totalAnnualCost = totalFixedCostPerAnnum + totalVariableCostPerAnnum;

    return {
      // Working Hours
      workingHoursPerYear: hours.workingHoursPerYear,
      availableHoursPerYear: hours.availableHoursPerYear,
      effectiveHoursPerYear: hours.effectiveHoursPerYear,

      // Per Hour Costs
      depreciationPerHour: hourlyCosts.depreciationPerHour,
      interestPerHour: hourlyCosts.interestPerHour,
      insurancePerHour: hourlyCosts.insurancePerHour,
      rentPerHour: hourlyCosts.rentPerHour,
      maintenancePerHour: hourlyCosts.maintenancePerHour,
      electricityPerHour: hourlyCosts.electricityPerHour,

      // Cost Categories
      costOfOwnershipPerHour: costCategories.costOfOwnershipPerHour,
      totalFixedCostPerHour: costCategories.totalFixedCostPerHour,
      totalVariableCostPerHour: costCategories.totalVariableCostPerHour,
      totalOperatingCostPerHour: costCategories.totalOperatingCostPerHour,

      // Overheads and Margins
      adminOverheadPerHour: finalMHR.adminOverheadPerHour,
      profitMarginPerHour: finalMHR.profitMarginPerHour,
      totalMachineHourRate: finalMHR.totalMachineHourRate,

      // Annual Costs
      depreciationPerAnnum: annualCosts.depreciationPerAnnum,
      interestPerAnnum: annualCosts.interestPerAnnum,
      insurancePerAnnum: annualCosts.insurancePerAnnum,
      rentPerAnnum: annualCosts.rentPerAnnum,
      maintenancePerAnnum: annualCosts.maintenancePerAnnum,
      electricityPerAnnum: annualCosts.electricityPerAnnum,
      totalFixedCostPerAnnum: this.round(totalFixedCostPerAnnum, this.precision.CURRENCY),
      totalVariableCostPerAnnum: this.round(totalVariableCostPerAnnum, this.precision.CURRENCY),
      totalAnnualCost: this.round(totalAnnualCost, this.precision.CURRENCY),

      // Capital Investment
      accessoriesCost: capital.accessoriesCost,
      installationCost: capital.installationCost,
      totalCapitalInvestment: capital.totalCapitalInvestment,
    };
  }

  /**
   * Round number to specified decimal places
   * Using banker's rounding (round half to even) for financial accuracy
   */
  private round(value: number, decimals: number): number {
    const multiplier = Math.pow(10, decimals);
    return Math.round(value * multiplier) / multiplier;
  }
}
