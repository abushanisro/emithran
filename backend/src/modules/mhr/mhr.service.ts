import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateMHRDto, UpdateMHRDto, QueryMHRDto } from './dto/mhr.dto';
import { MHRResponseDto, MHRListResponseDto, MHRCalculationResult } from './dto/mhr-response.dto';
import { validate as isValidUUID } from 'uuid';
import { MHRCalculationEngine } from './engines/mhr-calculation.engine';
import { MHRInputValidator } from './validators/mhr-input.validator';
import * as ExcelJS from 'exceljs';

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
   * Create a complete MHRCalculationResult for manual entries
   * All values set to 0 except the manual MHR value
   */
  private createManualEntryCalculation(manualMHRValue: number): MHRCalculationResult {
    return {
      // Working Hours Calculations
      workingHoursPerYear: 0,
      availableHoursPerYear: 0,
      effectiveHoursPerYear: 0,
      
      // Cost Components - Per Hour
      depreciationPerHour: 0,
      interestPerHour: 0,
      insurancePerHour: 0,
      rentPerHour: 0,
      maintenancePerHour: 0,
      electricityPerHour: 0,
      
      // Totals - Per Hour
      costOfOwnershipPerHour: 0,
      totalFixedCostPerHour: manualMHRValue,
      totalVariableCostPerHour: 0,
      totalOperatingCostPerHour: manualMHRValue,
      adminOverheadPerHour: 0,
      profitMarginPerHour: 0,
      totalMachineHourRate: manualMHRValue,
      
      // Annual Costs
      depreciationPerAnnum: 0,
      interestPerAnnum: 0,
      insurancePerAnnum: 0,
      rentPerAnnum: 0,
      maintenancePerAnnum: 0,
      electricityPerAnnum: 0,
      totalFixedCostPerAnnum: 0,
      totalVariableCostPerAnnum: 0,
      totalAnnualCost: manualMHRValue * 8 * 250, // Estimate: 8hrs/day * 250 days
      
      // Capital Investment Breakdown
      accessoriesCost: 0,
      installationCost: 0,
      totalCapitalInvestment: 0,
    };
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
      // For manual entries, use stored values; for others, recalculate to ensure accuracy
      let calculations: MHRCalculationResult;
      
      if (row.is_manual_entry && row.manual_mhr_value) {
        // Use complete calculation result for manual entries
        calculations = this.createManualEntryCalculation(parseFloat(row.manual_mhr_value));
      } else {
        // Recalculate for automatic entries (skip validation for DB data)
        calculations = this.calculateMHR(this.mapRowToDto(row), true);
      }
      
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

    // For manual entries, use stored calculations; for others, recalculate to ensure accuracy
    let calculations: MHRCalculationResult;
    
    if (data.is_manual_entry && data.manual_mhr_value) {
      // Use complete calculation result for manual entries
      calculations = this.createManualEntryCalculation(parseFloat(data.manual_mhr_value));
    } else {
      // Recalculate for automatic entries (skip validation for DB data)
      calculations = this.calculateMHR(this.mapRowToDto(data), true);
    }
    
    return MHRResponseDto.fromDatabase({ ...data, calculations: JSON.stringify(calculations) });
  }

  async create(createMHRDto: CreateMHRDto, userId: string, accessToken: string): Promise<MHRResponseDto> {
    this.logger.log(`Creating MHR record for user: ${userId}`, 'MHRService');

    // Handle manual entry mode
    let calculations: MHRCalculationResult;
    if (createMHRDto.isManualEntry && createMHRDto.manualMHRValue) {
      this.logger.log(`Using manual MHR value: ${createMHRDto.manualMHRValue}`, 'MHRService');
      // Create complete calculation result for manual entry
      calculations = this.createManualEntryCalculation(createMHRDto.manualMHRValue);
    } else {
      // Calculate all metrics using the engine
      calculations = this.calculateMHR(createMHRDto);
    }

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
        is_manual_entry: createMHRDto.isManualEntry || false,
        manual_mhr_value: createMHRDto.manualMHRValue || null,
        // India 2026 extended fields
        process_group: createMHRDto.processGroup || null,
        machine_class: createMHRDto.machineClass || null,
        automation_level: createMHRDto.automationLevel || null,
        operators: createMHRDto.operators || null,
        wage_grade: createMHRDto.wageGrade || null,
        machine_price_usd: createMHRDto.machinePriceUsd || null,
        manufacturer_country: createMHRDto.manufacturerCountry || null,
        setup_time_hr: createMHRDto.setupTimeHr || null,
        lhr_inr_per_hr: createMHRDto.lhrInrPerHr || null,
        usd_labor_rate_per_hr: createMHRDto.usdLaborRatePerHr || null,
        usd_lhr_base: createMHRDto.usdLhrBase || null,
        usd_lhr_burden: createMHRDto.usdLhrBurden || null,
        usd_lhr_total: createMHRDto.usdLhrTotal || null,
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
    
    // Handle manual entry mode
    let calculations: MHRCalculationResult;
    if (updateMHRDto.isManualEntry && updateMHRDto.manualMHRValue) {
      this.logger.log(`Using manual MHR value for update: ${updateMHRDto.manualMHRValue}`, 'MHRService');
      // Create complete calculation result for manual entry
      calculations = this.createManualEntryCalculation(updateMHRDto.manualMHRValue);
    } else {
      // Calculate all metrics using the engine
      calculations = this.calculateMHR(mergedData);
    }

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
    if (updateMHRDto.isManualEntry !== undefined) updateData.is_manual_entry = updateMHRDto.isManualEntry;
    if (updateMHRDto.manualMHRValue !== undefined) updateData.manual_mhr_value = updateMHRDto.manualMHRValue;
    // India 2026 extended fields
    if (updateMHRDto.processGroup !== undefined) updateData.process_group = updateMHRDto.processGroup;
    if (updateMHRDto.machineClass !== undefined) updateData.machine_class = updateMHRDto.machineClass;
    if (updateMHRDto.automationLevel !== undefined) updateData.automation_level = updateMHRDto.automationLevel;
    if (updateMHRDto.operators !== undefined) updateData.operators = updateMHRDto.operators;
    if (updateMHRDto.wageGrade !== undefined) updateData.wage_grade = updateMHRDto.wageGrade;
    if (updateMHRDto.machinePriceUsd !== undefined) updateData.machine_price_usd = updateMHRDto.machinePriceUsd;
    if (updateMHRDto.manufacturerCountry !== undefined) updateData.manufacturer_country = updateMHRDto.manufacturerCountry;
    if (updateMHRDto.setupTimeHr !== undefined) updateData.setup_time_hr = updateMHRDto.setupTimeHr;
    if (updateMHRDto.lhrInrPerHr !== undefined) updateData.lhr_inr_per_hr = updateMHRDto.lhrInrPerHr;
    if (updateMHRDto.usdLaborRatePerHr !== undefined) updateData.usd_labor_rate_per_hr = updateMHRDto.usdLaborRatePerHr;
    if (updateMHRDto.usdLhrBase !== undefined) updateData.usd_lhr_base = updateMHRDto.usdLhrBase;
    if (updateMHRDto.usdLhrBurden !== undefined) updateData.usd_lhr_burden = updateMHRDto.usdLhrBurden;
    if (updateMHRDto.usdLhrTotal !== undefined) updateData.usd_lhr_total = updateMHRDto.usdLhrTotal;

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

  async importFromExcel(
    fileBuffer: Buffer,
    userId: string,
    accessToken: string,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    this.logger.log(`Importing MHR records from Excel for user ${userId}`, 'MHRService');

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);

    // Sheet name → commodity code for the multi-sheet aPriori format
    const SHEET_COMMODITY: Record<string, string> = {
      '01_machining': 'CNC Machining', '02_sheet_metal': 'Sheet Metal',
      '03_die_casting': 'Die Casting', '04_invest_cast': 'Investment Casting',
      '05_sand_casting': 'Sand Casting', '06_forging': 'Forging',
      '07_additive': 'Additive Manufacturing', '08_plastic_mold': 'Plastic Molding',
      '09_heat_treat': 'Heat Treatment', '10_pcb': 'PCB Manufacturing',
      '11_composites': 'Composites', '12_surface_treat': 'Surface Treatment',
      '13_powder_metal': 'Powder Metallurgy', '14_assembly': 'Assembly',
      '15_bar_tube': 'Bar & Tube Fabrication', '16_roto_blow': 'Roto & Blow Molding',
      '17_sheet_plastic': 'Sheet Plastic', '18_rapid_proto': 'Rapid Prototyping',
    };

    // Collect candidate sheets: explicit "MHR" names first, then numbered process sheets
    const namedSheet = workbook.worksheets.find(ws =>
      ['mhr', 'machine hour rate', 'machine hour rates'].includes(ws.name.toLowerCase().trim())
    );
    const processSheets = workbook.worksheets.filter(ws =>
      /^\d{2}_/.test(ws.name.trim()) && ws.name.toLowerCase().trim() !== '00_index'
    );
    const sheetsToProcess = namedSheet ? [namedSheet] : processSheets;

    if (sheetsToProcess.length === 0) {
      this.logger.log('No MHR sheet found in Excel file — skipping MHR import', 'MHRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    const toNum = (v: ExcelJS.CellValue, fallback: number): number => {
      if (v == null) return fallback;
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? fallback : n;
    };
    const toStr = (v: ExcelJS.CellValue, fallback = ''): string =>
      v != null ? String(v).trim() : fallback;

    const rows: any[] = [];

    for (const sheet of sheetsToProcess) {
      const sheetKey = sheet.name.toLowerCase().trim();
      const commodityFromSheet = SHEET_COMMODITY[sheetKey] ?? sheetKey;

      // Build header → column-number map from row 1
      const colMap: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell, colNum) => {
        const h = toStr(cell.value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (h) colMap[h] = colNum;
      });

      const getCol = (...keys: string[]): number | null => {
        for (const k of keys) if (colMap[k] !== undefined) return colMap[k];
        return null;
      };

      // Support both standard format ("Machine Name") and aPriori multi-sheet format ("Primary ID")
      const machineNameCol      = getCol('machine name', 'primary id', 'name');
      if (!machineNameCol) continue;

      const locationCol         = getCol('location', 'manufacturer information', 'machine manufacturer location');
      const commodityCodeCol    = getCol('commodity code');
      const machineDescCol      = getCol('machine description', 'other id', 'description');
      const manufacturerCol     = getCol('manufacturer');
      const modelCol            = getCol('model');
      const specCol             = getCol('specification');
      const shiftsCol           = getCol('shifts day', 'shifts per day', 'shifts_per_day');
      const hoursCol            = getCol('hours shift', 'hours per shift', 'hours_per_shift');
      const daysCol             = getCol('working days year', 'working days per year', 'working_days_per_year');
      const maintHoursCol       = getCol('planned maint hours year', 'planned maintenance hours year', 'maintenance_hours_per_year');
      const utilCol             = getCol('capacity utilization', 'capacity utilization rate', 'avg utilization', 'yields', 'capacity_utilization_pct');
      const landedCostCol       = getCol('landed machine cost', 'landed cost', 'machine price', 'bottom up over', 'landed_machine_cost_inr');
      const accessoriesCol      = getCol('accessories cost', 'accessories cost', 'accessories_pct');
      const installationCol     = getCol('installation cost', 'installation cost', 'installation_pct');
      const paybackCol          = getCol('payback period yrs', 'payback period years', 'payback period', 'payback_years');
      const interestCol         = getCol('interest rate', 'interest rate', 'interest_rate_pct');
      const insuranceCol        = getCol('insurance rate', 'insurance rate', 'insurance_rate_pct');
      const footprintCol        = getCol('machine footprint sqm', 'machine footprint', 'machine_footprint_m2');
      const rentCol             = getCol('rent sqm month', 'rent per sqm per month', 'rent_per_m2_per_month_inr');
      const maintenanceCol      = getCol('maintenance cost', 'maintenance cost', 'maintenance_cost_pct');
      const powerCol            = getCol('power kwh per hour', 'power kwh hr', 'spindle power kw', 'powers', 'power_kwh_per_hour');
      const electricityCol      = getCol('electricity cost kwh', 'electricity cost per kwh', 'electricity_cost_per_kwh_inr');
      const adminCol            = getCol('admin overhead', 'admin overhead', 'admin_overhead_pct');
      const profitCol           = getCol('profit margin', 'profit margin', 'profit_margin_pct');
      const mhrValueCol         = getCol('mhr hour', 'mhr', 'mhr value', 'mhr_inr_per_hour', 'accounting', 'labour rate');
      // India 2026 extended columns
      const processGroupCol     = getCol('process group', 'process_group');
      const processCategoryCol  = getCol('process category', 'process_category');
      const machineClassCol     = getCol('machine class', 'machine_class');
      const automationLevelCol  = getCol('automation level', 'automation_level');
      const operatorsCol        = getCol('operators');
      const wageGradeCol        = getCol('wage grade', 'wage_grade');
      const machinePriceUsdCol  = getCol('machine price usd', 'machine_price_usd');
      const mfrCountryCol       = getCol('manufacturer country', 'manufacturer_country');
      const setupTimeCol        = getCol('setup time hr', 'setup time hr', 'setup_time_hr');
      const lhrInrCol           = getCol('lhr hr india', 'lhr inr hr', 'lhr_inr_per_hr_india', 'lhr_inr_per_hour');
      // USD LHR columns embedded in the MHR sheet
      const usdLaborRateCol     = getCol('labor rate usd hr', 'labor rate usd hr person', 'usd labor rate', 'labor_rate_usd_per_hr');
      const usdLhrBaseCol       = getCol('lhr base usd hr', 'usd lhr base', 'lhr_base_usd_per_hr');
      const usdLhrBurdenCol     = getCol('lhr burden 38 usd hr', 'usd lhr burden', 'lhr_burden_38pct_usd_per_hr');
      const usdLhrTotalCol      = getCol('lhr total usd hr', 'usd lhr total', 'lhr_total_usd_per_hr');
      // specs sub-columns (optional)
      const maxCapacityCol      = getCol('max capacity', 'max_capacity');
      const toleranceCol        = getCol('tolerance mm', 'tolerance_mm');
      const raCol               = getCol('surface finish ra um', 'surface_finish_ra_um');
      const materialsCol        = getCol('material compatibility', 'material_compatibility');
      const applicationsCol     = getCol('typical applications', 'typical_applications');
      const processNotesCol     = getCol('process notes', 'process_notes');

      let isHeaderRow = true;
      sheet.eachRow(row => {
        if (isHeaderRow) { isHeaderRow = false; return; }

        const machineName = toStr(row.getCell(machineNameCol).value);
        if (!machineName) return;

        const mhrRaw = mhrValueCol ? row.getCell(mhrValueCol).value : null;
        const mhrNum = mhrRaw != null ? parseFloat(String(mhrRaw).replace(/[^0-9.-]/g, '')) : NaN;

        // Skip sub-header rows (row 2 in aPriori sheets has labels like "Name", "Labor Rate (USD/hr)")
        // Detected by: mhrValueCol exists but cell is a non-numeric string
        if (mhrValueCol && typeof mhrRaw === 'string' && isNaN(mhrNum)) return;

        const isManual = mhrValueCol !== null && !isNaN(mhrNum) && mhrNum > 0;
        const landedCost = landedCostCol ? toNum(row.getCell(landedCostCol).value, 0) : 0;

        // Derive utilization: aPriori stores it as 0-1 fraction, convert to percentage
        let utilRaw = utilCol ? toNum(row.getCell(utilCol).value, 0.85) : 0.85;
        if (utilRaw > 0 && utilRaw <= 1) utilRaw = utilRaw * 100; // 0.5 → 50%

        const processGroupVal = processGroupCol ? toStr(row.getCell(processGroupCol).value) || commodityFromSheet : commodityFromSheet;
        const specsObj: Record<string, any> = {};
        if (maxCapacityCol)   { const v = toStr(row.getCell(maxCapacityCol).value);   if (v) specsObj.max_capacity = v; }
        if (toleranceCol)     { const v = toNum(row.getCell(toleranceCol).value, 0);  if (v) specsObj.tolerance_mm = v; }
        if (raCol)            { const v = toNum(row.getCell(raCol).value, 0);          if (v) specsObj.surface_finish_ra_um = v; }
        if (materialsCol)     { const v = toStr(row.getCell(materialsCol).value);      if (v) specsObj.material_compatibility = v; }
        if (applicationsCol)  { const v = toStr(row.getCell(applicationsCol).value);   if (v) specsObj.typical_applications = v; }
        if (processNotesCol)  { const v = toStr(row.getCell(processNotesCol).value);   if (v) specsObj.process_notes = v; }

        rows.push({
          user_id:                            userId,
          machine_name:                       machineName,
          location:                           locationCol ? toStr(row.getCell(locationCol).value, 'India') || 'India' : 'India',
          commodity_code:                     commodityCodeCol ? toStr(row.getCell(commodityCodeCol).value, processGroupVal) || processGroupVal : processGroupVal,
          machine_description:                machineDescCol ? toStr(row.getCell(machineDescCol).value) || null : null,
          manufacturer:                       manufacturerCol ? toStr(row.getCell(manufacturerCol).value) || null : null,
          model:                              modelCol ? toStr(row.getCell(modelCol).value) || null : null,
          specification:                      specCol ? toStr(row.getCell(specCol).value) || null : null,
          shifts_per_day:                     shiftsCol ? toNum(row.getCell(shiftsCol).value, 3) : 3,
          hours_per_shift:                    hoursCol ? toNum(row.getCell(hoursCol).value, 8) : 8,
          working_days_per_year:              daysCol ? toNum(row.getCell(daysCol).value, 260) : 260,
          planned_maintenance_hours_per_year: maintHoursCol ? toNum(row.getCell(maintHoursCol).value, 0) : 0,
          capacity_utilization_rate:          Math.min(Math.max(utilRaw, 1), 100),
          landed_machine_cost:                Math.max(landedCost, 1),
          accessories_cost_percentage:        accessoriesCol ? toNum(row.getCell(accessoriesCol).value, 6) : 6,
          installation_cost_percentage:       installationCol ? toNum(row.getCell(installationCol).value, 20) : 20,
          payback_period_years:               paybackCol ? toNum(row.getCell(paybackCol).value, 10) : 10,
          interest_rate_percentage:           interestCol ? toNum(row.getCell(interestCol).value, 8) : 8,
          insurance_rate_percentage:          insuranceCol ? toNum(row.getCell(insuranceCol).value, 1) : 1,
          machine_footprint_sqm:              footprintCol ? toNum(row.getCell(footprintCol).value, 0) : 0,
          rent_per_sqm_per_month:             rentCol ? toNum(row.getCell(rentCol).value, 250) : 250,
          maintenance_cost_percentage:        maintenanceCol ? toNum(row.getCell(maintenanceCol).value, 6) : 6,
          power_kwh_per_hour:                 powerCol ? toNum(row.getCell(powerCol).value, 0) : 0,
          electricity_cost_per_kwh:           electricityCol ? toNum(row.getCell(electricityCol).value, 8.36) : 8.36,
          admin_overhead_percentage:          adminCol ? toNum(row.getCell(adminCol).value, 0) : 0,
          profit_margin_percentage:           profitCol ? toNum(row.getCell(profitCol).value, 0) : 0,
          is_manual_entry:                    isManual,
          manual_mhr_value:                   isManual ? mhrNum : null,
          total_machine_hour_rate:            null as number | null,
          total_fixed_cost_per_hour:          null as number | null,
          total_variable_cost_per_hour:       null as number | null,
          total_annual_cost:                  null as number | null,
          // India 2026 extended fields
          process_group:        processGroupVal || null,
          process_category:     processCategoryCol ? toStr(row.getCell(processCategoryCol).value) || null : null,
          machine_class:        machineClassCol ? toStr(row.getCell(machineClassCol).value) || null : null,
          automation_level:     automationLevelCol ? toStr(row.getCell(automationLevelCol).value) || null : null,
          operators:            operatorsCol ? Math.max(1, toNum(row.getCell(operatorsCol).value, 1)) : 1,
          wage_grade:           wageGradeCol ? toStr(row.getCell(wageGradeCol).value) || null : null,
          machine_price_usd:    machinePriceUsdCol ? toNum(row.getCell(machinePriceUsdCol).value, 0) || null : null,
          manufacturer_country: mfrCountryCol ? toStr(row.getCell(mfrCountryCol).value) || null : null,
          setup_time_hr:        setupTimeCol ? toNum(row.getCell(setupTimeCol).value, 0) || null : null,
          lhr_inr_per_hr:       lhrInrCol ? toNum(row.getCell(lhrInrCol).value, 0) || null : null,
          usd_labor_rate_per_hr: usdLaborRateCol ? toNum(row.getCell(usdLaborRateCol).value, 0) || null : null,
          usd_lhr_base:          usdLhrBaseCol ? toNum(row.getCell(usdLhrBaseCol).value, 0) || null : null,
          usd_lhr_burden:        usdLhrBurdenCol ? toNum(row.getCell(usdLhrBurdenCol).value, 0) || null : null,
          usd_lhr_total:         usdLhrTotalCol ? toNum(row.getCell(usdLhrTotalCol).value, 0) || null : null,
          specs:                Object.keys(specsObj).length ? specsObj : null,
        });
      });
    }

    if (rows.length === 0) {
      this.logger.log('No valid machine rows found across all MHR sheets', 'MHRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    // Compute stored calculated fields
    for (const record of rows) {
      try {
        if (record.is_manual_entry) {
          const calc = this.createManualEntryCalculation(record.manual_mhr_value);
          record.total_machine_hour_rate      = calc.totalMachineHourRate;
          record.total_fixed_cost_per_hour    = calc.totalFixedCostPerHour;
          record.total_variable_cost_per_hour = calc.totalVariableCostPerHour;
          record.total_annual_cost            = calc.totalAnnualCost;
        } else {
          const calc = this.calculateMHR(this.mapRowToDto(record), true);
          record.total_machine_hour_rate      = calc.totalMachineHourRate;
          record.total_fixed_cost_per_hour    = calc.totalFixedCostPerHour;
          record.total_variable_cost_per_hour = calc.totalVariableCostPerHour;
          record.total_annual_cost            = calc.totalAnnualCost;
        }
      } catch {
        record.total_machine_hour_rate      = 0;
        record.total_fixed_cost_per_hour    = 0;
        record.total_variable_cost_per_hour = 0;
        record.total_annual_cost            = 0;
      }
    }

    // Filter out machine names that already exist for this user (no unique constraint → manual dedup)
    const client = this.supabaseService.getClient(accessToken);
    const { data: existing } = await client
      .from('mhr_records')
      .select('machine_name')
      .eq('user_id', userId);
    const existingNames = new Set((existing ?? []).map((r: any) => (r.machine_name as string).toLowerCase()));

    const newRows = rows.filter(r => !existingNames.has((r.machine_name as string).toLowerCase()));
    const skipped = rows.length - newRows.length;

    if (newRows.length === 0) return { imported: 0, skipped, errors: [] };

    let imported = 0;
    const errors: string[] = [];
    const CHUNK_SIZE = 200;

    for (let offset = 0; offset < newRows.length; offset += CHUNK_SIZE) {
      const chunk = newRows.slice(offset, offset + CHUNK_SIZE);
      const { data, error } = await client
        .from('mhr_records')
        .insert(chunk)
        .select('id');
      if (error) {
        this.logger.error(`MHR import chunk error at offset ${offset}: ${error.message}`, 'MHRService');
        errors.push(`Batch at offset ${offset} failed: ${error.message}`);
      } else {
        imported += (data ?? []).length;
      }
    }

    this.logger.log(`MHR import complete: ${imported} imported, ${skipped} skipped`, 'MHRService');
    return { imported, skipped, errors };
  }

  async removeAll(userId: string, accessToken: string): Promise<{ deleted: number }> {
    this.logger.log(`Deleting all MHR records for user ${userId}`, 'MHRService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('mhr_records')
      .delete()
      .eq('user_id', userId)
      .select('id');

    if (error) {
      this.logger.error(`Error deleting all MHR records: ${error.message}`, 'MHRService');
      throw new InternalServerErrorException('Failed to delete all MHR records.');
    }

    return { deleted: (data ?? []).length };
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
      isManualEntry: row.isManualEntry || row.is_manual_entry || false,
      manualMHRValue: row.manualMHRValue || (row.manual_mhr_value ? parseFloat(row.manual_mhr_value) : 0),
    };
  }
}
