import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateMHRDto, UpdateMHRDto, QueryMHRDto } from './dto/mhr.dto';
import { MHRResponseDto, MHRListResponseDto, MHRCalculationResult } from './dto/mhr-response.dto';
import { validate as isValidUUID } from 'uuid';
import { MHRCalculationEngine } from './engines/mhr-calculation.engine';
import { MHRInputValidator } from './validators/mhr-input.validator';

/**
 * MHR Service
 *
 * Implements manufacturing cost engineering business logic following industry best practices.
 * Provides CRUD operations with automatic MHR calculation and validation.
 *
 * Architecture:
 * - Separation of Concerns: Business logic separate from calculation logic
 * - Dependency Injection: Clean testable design
 * - Input Validation: Industry-standard validation rules
 * - Error Handling: Proper exception handling with logging
 * - Data Integrity: Recalculation on fetch ensures accuracy
 *
 * @version 2.0.0
 */
@Injectable()
export class MHRService {
  private readonly calculationEngine: MHRCalculationEngine;
  private readonly validator: MHRInputValidator;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {
    this.calculationEngine = new MHRCalculationEngine();
    this.validator = new MHRInputValidator();
  }

  /**
   * Calculate all MHR metrics based on input parameters
   * Uses the calculation engine for clean separation of concerns
   *
   * @param dto Input parameters
   * @param skipValidation Skip validation for recalculations (default: false)
   * @returns Complete MHR calculation result
   */
  calculateMHR(dto: CreateMHRDto | UpdateMHRDto, skipValidation = false): MHRCalculationResult {
    try {
      // Validate inputs according to industry standards (skip for recalculations from DB)
      if (!skipValidation) {
        this.validator.validateAndThrow(dto);
      }

      // Delegate calculation to the specialized engine
      const result = this.calculationEngine.calculate(dto);

      this.logger.log('MHR calculation completed successfully', 'MHRService');

      return result;
    } catch (error) {
      this.logger.error(`MHR calculation failed: ${error.message}`, 'MHRService');
      throw error;
    }
  }

  async findAll(query: QueryMHRDto, userId?: string, accessToken?: string): Promise<MHRListResponseDto> {
    this.logger.log('Fetching all MHR records', 'MHRService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (query.search) {
      queryBuilder = queryBuilder.or(`machine_name.ilike.%${query.search}%,machine_description.ilike.%${query.search}%`);
    }

    if (query.location) {
      queryBuilder = queryBuilder.eq('location', query.location);
    }

    if (query.commodityCode) {
      queryBuilder = queryBuilder.eq('commodity_code', query.commodityCode);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching MHR records: ${error.message}`, 'MHRService');
      
      // Handle access permissions
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access these MHR records.');
      }
      
      // Handle query parameter issues
      if (error.message.includes('invalid input syntax')) {
        throw new BadRequestException('Invalid search parameters provided. Please check your filters and try again.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve MHR records. Please try again later.');
    }

    const records = (data || []).map(row => {
      // Recalculate on fetch to ensure accuracy (skip validation for DB data)
      const calculations = this.calculateMHR(this.mapRowToDto(row), true);
      return MHRResponseDto.fromDatabase({ ...row, calculations: JSON.stringify(calculations) });
    });

    return {
      records,
      total: count || 0,
      page,
      limit,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Fetching MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format provided: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      this.logger.error(`Error fetching MHR record ${id}: ${error.message}`, 'MHRService');
      
      if (error.message.includes('row-level security policy')) {
        throw new ForbiddenException('You do not have permission to access this MHR record.');
      }
      
      throw new InternalServerErrorException('Unable to retrieve MHR record. Please try again later.');
    }
    
    if (!data) {
      this.logger.warn(`MHR record not found: ${id}`, 'MHRService');
      throw new NotFoundException(`MHR record with ID ${id} was not found or you do not have access to it.`);
    }

    // Recalculate to ensure accuracy (skip validation for DB data)
    const calculations = this.calculateMHR(this.mapRowToDto(data), true);
    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async create(createMHRDto: CreateMHRDto, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Creating MHR record for user: ${userId}`, 'MHRService');

    // Calculate all metrics
    const calculations = this.calculateMHR(createMHRDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .insert({
        user_id: userId,
        location: createMHRDto.location,
        commodity_code: createMHRDto.commodityCode,
        machine_description: createMHRDto.machineDescription,
        manufacturer: createMHRDto.manufacturer,
        model: createMHRDto.model,
        machine_name: createMHRDto.machineName,
        specification: createMHRDto.specification,
        shifts_per_day: createMHRDto.shiftsPerDay,
        hours_per_shift: createMHRDto.hoursPerShift,
        working_days_per_year: createMHRDto.workingDaysPerYear,
        planned_maintenance_hours_per_year: createMHRDto.plannedMaintenanceHoursPerYear,
        capacity_utilization_rate: createMHRDto.capacityUtilizationRate,
        landed_machine_cost: createMHRDto.landedMachineCost,
        accessories_cost_percentage: createMHRDto.accessoriesCostPercentage,
        installation_cost_percentage: createMHRDto.installationCostPercentage,
        payback_period_years: createMHRDto.paybackPeriodYears,
        interest_rate_percentage: createMHRDto.interestRatePercentage,
        insurance_rate_percentage: createMHRDto.insuranceRatePercentage,
        machine_footprint_sqm: createMHRDto.machineFootprintSqm,
        rent_per_sqm_per_month: createMHRDto.rentPerSqmPerMonth,
        maintenance_cost_percentage: createMHRDto.maintenanceCostPercentage,
        power_kwh_per_hour: createMHRDto.powerKwhPerHour,
        electricity_cost_per_kwh: createMHRDto.electricityCostPerKwh,
        admin_overhead_percentage: createMHRDto.adminOverheadPercentage,
        profit_margin_percentage: createMHRDto.profitMarginPercentage,
        total_machine_hour_rate: calculations.totalMachineHourRate,
        total_fixed_cost_per_hour: calculations.totalFixedCostPerHour,
        total_variable_cost_per_hour: calculations.totalVariableCostPerHour,
        total_annual_cost: calculations.totalAnnualCost,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating MHR record: ${error.message}`, 'MHRService');
      
      // Handle duplicate machine name constraint
      if (error.message.includes('duplicate key') && error.message.includes('machine_name')) {
        throw new ConflictException(
          'A machine with this name already exists in your workspace. Please choose a different machine name.'
        );
      }
      
      // Handle foreign key constraints
      if (error.message.includes('violates foreign key constraint')) {
        if (error.message.includes('user_id')) {
          throw new BadRequestException('User account is not valid. Please log in again.');
        }
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('positive_values')) {
          throw new BadRequestException('All cost and rate values must be positive numbers.');
        }
        if (error.message.includes('percentage_values')) {
          throw new BadRequestException('Percentage values must be between 0 and 100.');
        }
        if (error.message.includes('shifts_per_day_range')) {
          throw new BadRequestException('Shifts per day must be between 1 and 4.');
        }
        if (error.message.includes('hours_per_shift_range')) {
          throw new BadRequestException('Hours per shift must be between 1 and 24.');
        }
      }
      
      throw new InternalServerErrorException('Failed to create MHR record. Please check your input and try again.');
    }

    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async update(id: string, updateMHRDto: UpdateMHRDto, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Updating MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for update: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format provided. Please check the ID and try again.');
    }

    // Verify record exists
    const existing = await this.findOne(id, userId, accessToken);

    // Merge existing data with updates for calculation
    const mergedData = { ...this.mapRowToDto(existing), ...updateMHRDto };
    const calculations = this.calculateMHR(mergedData);

    const updateData: any = {};
    if (updateMHRDto.location !== undefined) updateData.location = updateMHRDto.location;
    if (updateMHRDto.commodityCode !== undefined) updateData.commodity_code = updateMHRDto.commodityCode;
    if (updateMHRDto.machineDescription !== undefined) updateData.machine_description = updateMHRDto.machineDescription;
    if (updateMHRDto.manufacturer !== undefined) updateData.manufacturer = updateMHRDto.manufacturer;
    if (updateMHRDto.model !== undefined) updateData.model = updateMHRDto.model;
    if (updateMHRDto.machineName !== undefined) updateData.machine_name = updateMHRDto.machineName;
    if (updateMHRDto.specification !== undefined) updateData.specification = updateMHRDto.specification;
    if (updateMHRDto.shiftsPerDay !== undefined) updateData.shifts_per_day = updateMHRDto.shiftsPerDay;
    if (updateMHRDto.hoursPerShift !== undefined) updateData.hours_per_shift = updateMHRDto.hoursPerShift;
    if (updateMHRDto.workingDaysPerYear !== undefined) updateData.working_days_per_year = updateMHRDto.workingDaysPerYear;
    if (updateMHRDto.plannedMaintenanceHoursPerYear !== undefined) updateData.planned_maintenance_hours_per_year = updateMHRDto.plannedMaintenanceHoursPerYear;
    if (updateMHRDto.capacityUtilizationRate !== undefined) updateData.capacity_utilization_rate = updateMHRDto.capacityUtilizationRate;
    if (updateMHRDto.landedMachineCost !== undefined) updateData.landed_machine_cost = updateMHRDto.landedMachineCost;
    if (updateMHRDto.accessoriesCostPercentage !== undefined) updateData.accessories_cost_percentage = updateMHRDto.accessoriesCostPercentage;
    if (updateMHRDto.installationCostPercentage !== undefined) updateData.installation_cost_percentage = updateMHRDto.installationCostPercentage;
    if (updateMHRDto.paybackPeriodYears !== undefined) updateData.payback_period_years = updateMHRDto.paybackPeriodYears;
    if (updateMHRDto.interestRatePercentage !== undefined) updateData.interest_rate_percentage = updateMHRDto.interestRatePercentage;
    if (updateMHRDto.insuranceRatePercentage !== undefined) updateData.insurance_rate_percentage = updateMHRDto.insuranceRatePercentage;
    if (updateMHRDto.machineFootprintSqm !== undefined) updateData.machine_footprint_sqm = updateMHRDto.machineFootprintSqm;
    if (updateMHRDto.rentPerSqmPerMonth !== undefined) updateData.rent_per_sqm_per_month = updateMHRDto.rentPerSqmPerMonth;
    if (updateMHRDto.maintenanceCostPercentage !== undefined) updateData.maintenance_cost_percentage = updateMHRDto.maintenanceCostPercentage;
    if (updateMHRDto.powerKwhPerHour !== undefined) updateData.power_kwh_per_hour = updateMHRDto.powerKwhPerHour;
    if (updateMHRDto.electricityCostPerKwh !== undefined) updateData.electricity_cost_per_kwh = updateMHRDto.electricityCostPerKwh;
    if (updateMHRDto.adminOverheadPercentage !== undefined) updateData.admin_overhead_percentage = updateMHRDto.adminOverheadPercentage;
    if (updateMHRDto.profitMarginPercentage !== undefined) updateData.profit_margin_percentage = updateMHRDto.profitMarginPercentage;

    // Update calculated values
    updateData.total_machine_hour_rate = calculations.totalMachineHourRate;
    updateData.total_fixed_cost_per_hour = calculations.totalFixedCostPerHour;
    updateData.total_variable_cost_per_hour = calculations.totalVariableCostPerHour;
    updateData.total_annual_cost = calculations.totalAnnualCost;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating MHR record: ${error.message}`, 'MHRService');
      
      // Handle concurrent update conflicts
      if (error.message.includes('row was updated by another user')) {
        throw new ConflictException(
          'This MHR record has been modified by another user. Please refresh and try again.'
        );
      }
      
      // Handle duplicate machine name constraint
      if (error.message.includes('duplicate key') && error.message.includes('machine_name')) {
        throw new ConflictException(
          'A machine with this name already exists in your workspace. Please choose a different machine name.'
        );
      }
      
      // Handle validation constraints
      if (error.message.includes('violates check constraint')) {
        if (error.message.includes('positive_values')) {
          throw new BadRequestException('All cost and rate values must be positive numbers.');
        }
        if (error.message.includes('percentage_values')) {
          throw new BadRequestException('Percentage values must be between 0 and 100.');
        }
      }
      
      throw new InternalServerErrorException('Failed to update MHR record. Please verify your input and try again.');
    }

    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting MHR record: ${id}`, 'MHRService');

    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format for delete: ${id}`, 'MHRService');
      throw new BadRequestException('Invalid MHR record ID format provided. Please check the ID and try again.');
    }

    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting MHR record: ${error.message}`, 'MHRService');
      
      // Handle foreign key constraint violations (MHR record referenced elsewhere)
      if (error.message.includes('violates foreign key constraint')) {
        throw new ConflictException(
          'This MHR record cannot be deleted as it is being used in other calculations or processes. Please remove those references first.'
        );
      }
      
      throw new InternalServerErrorException('Failed to delete MHR record. Please try again later.');
    }

    return { message: 'MHR record deleted successfully' };
  }

  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
  }

  private mapRowToDto(row: any): CreateMHRDto {
    return {
      location: row.location,
      commodityCode: row.commodityCode || row.commodity_code,
      machineDescription: row.machineDescription || row.machine_description,
      manufacturer: row.manufacturer,
      model: row.model,
      machineName: row.machineName || row.machine_name,
      specification: row.specification,
      shiftsPerDay: parseFloat(row.shiftsPerDay || row.shifts_per_day || 3),
      hoursPerShift: parseFloat(row.hoursPerShift || row.hours_per_shift || 8),
      workingDaysPerYear: parseFloat(row.workingDaysPerYear || row.working_days_per_year || 260),
      plannedMaintenanceHoursPerYear: parseFloat(row.plannedMaintenanceHoursPerYear || row.planned_maintenance_hours_per_year || 0),
      capacityUtilizationRate: parseFloat(row.capacityUtilizationRate || row.capacity_utilization_rate || 95),
      landedMachineCost: parseFloat(row.landedMachineCost || row.landed_machine_cost || 0),
      accessoriesCostPercentage: parseFloat(row.accessoriesCostPercentage || row.accessories_cost_percentage || 6),
      installationCostPercentage: parseFloat(row.installationCostPercentage || row.installation_cost_percentage || 20),
      paybackPeriodYears: parseFloat(row.paybackPeriodYears || row.payback_period_years || 10),
      interestRatePercentage: parseFloat(row.interestRatePercentage || row.interest_rate_percentage || 8),
      insuranceRatePercentage: parseFloat(row.insuranceRatePercentage || row.insurance_rate_percentage || 1),
      machineFootprintSqm: parseFloat(row.machineFootprintSqm || row.machine_footprint_sqm || 0),
      rentPerSqmPerMonth: parseFloat(row.rentPerSqmPerMonth || row.rent_per_sqm_per_month || 0),
      maintenanceCostPercentage: parseFloat(row.maintenanceCostPercentage || row.maintenance_cost_percentage || 6),
      powerKwhPerHour: parseFloat(row.powerKwhPerHour || row.power_kwh_per_hour || 0),
      electricityCostPerKwh: parseFloat(row.electricityCostPerKwh || row.electricity_cost_per_kwh || 0),
      adminOverheadPercentage: parseFloat(row.adminOverheadPercentage || row.admin_overhead_percentage || 0),
      profitMarginPercentage: parseFloat(row.profitMarginPercentage || row.profit_margin_percentage || 0),
    };
  }
}
