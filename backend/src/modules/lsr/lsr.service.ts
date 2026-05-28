import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, ConflictException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateLSRDto, UpdateLSRDto } from './lsr.dto';
import { validate as isValidUUID } from 'uuid';
import * as ExcelJS from 'exceljs';

@Injectable()
export class LSRService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) { }

  async create(createLSRDto: CreateLSRDto, userId: string, accessToken: string) {
    this.logger.log(`Creating LSR record for user: ${userId}`, 'LSRService');

    // Check if labour code already exists
    const { data: existing } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .select('id')
      .eq('labour_code', createLSRDto.labourCode)
      .single();

    if (existing) {
      throw new ConflictException(`Labour code ${createLSRDto.labourCode} already exists`);
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .insert({
        user_id: userId,
        labour_code: createLSRDto.labourCode,
        labour_type: createLSRDto.labourType,
        description: createLSRDto.description,
        minimum_wage_per_day: createLSRDto.minimumWagePerDay,
        minimum_wage_per_month: createLSRDto.minimumWagePerMonth,
        dearness_allowance: createLSRDto.dearnessAllowance,
        perks_percentage: createLSRDto.perksPercentage,
        lhr: createLSRDto.lhr,
        reference: createLSRDto.reference || null,
        location: createLSRDto.location || null,
        process_group: createLSRDto.processGroup || null,
        machine_name: createLSRDto.machineName || null,
        machine_description: createLSRDto.machineDescription || null,
        manufacturer: createLSRDto.manufacturer || null,
        manufacturer_country: createLSRDto.manufacturerCountry || null,
        wage_grade: createLSRDto.wageGrade || null,
        operators: createLSRDto.operators || null,
        shifts_per_day: createLSRDto.shiftsPerDay || null,
        hours_per_shift: createLSRDto.hoursPerShift || null,
        working_days_per_year: createLSRDto.workingDaysPerYear || null,
        total_hrs_per_year: createLSRDto.totalHrsPerYear || null,
        usd_labor_rate_per_hr: createLSRDto.usdLaborRatePerHr || null,
        usd_lhr_base: createLSRDto.usdLhrBase || null,
        usd_lhr_burden: createLSRDto.usdLhrBurden || null,
        usd_lhr_total: createLSRDto.usdLhrTotal || null,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating LSR record: ${error.message}`, 'LSRService');
      throw new InternalServerErrorException(`Failed to create LSR record: ${error.message}`);
    }

    return this.mapDatabaseToResponse(data);
  }

  async findAll(search: string | undefined, userId?: string, accessToken?: string) {
    this.logger.log('Fetching all LSR records', 'LSRService');

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .select('*')
      .order('labour_code', { ascending: true });

    if (search) {
      queryBuilder = queryBuilder.or(`labour_code.ilike.%${search}%,labour_type.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const { data, error } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching LSR records: ${error.message}`, 'LSRService');
      throw new InternalServerErrorException(`Failed to fetch LSR records: ${error.message}`);
    }

    return (data || []).map(row => this.mapDatabaseToResponse(row));
  }

  async findOne(id: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching LSR record: ${id}`, 'LSRService');

    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid LSR record ID format');
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.warn(`LSR record not found: ${id}`, 'LSRService');
      throw new NotFoundException(`LSR record with ID ${id} not found`);
    }

    return this.mapDatabaseToResponse(data);
  }

  async findByLabourCode(labourCode: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching LSR record by code: ${labourCode}`, 'LSRService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .select('*')
      .eq('labour_code', labourCode)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Labour code ${labourCode} not found`);
    }

    return this.mapDatabaseToResponse(data);
  }

  async update(id: string, updateLSRDto: UpdateLSRDto, userId: string, accessToken: string) {
    this.logger.log(`Updating LSR record: ${id}`, 'LSRService');

    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid LSR record ID format');
    }

    // Verify record exists
    await this.findOne(id, userId, accessToken);

    // Check for duplicate labour code if updating
    if (updateLSRDto.labourCode) {
      const { data: existing } = await this.supabaseService
        .getClient(accessToken)
        .from('lsr_records')
        .select('id')
        .eq('labour_code', updateLSRDto.labourCode)
        .neq('id', id)
        .single();

      if (existing) {
        throw new ConflictException(`Labour code ${updateLSRDto.labourCode} already exists`);
      }
    }

    const updateData: any = {};
    if (updateLSRDto.labourCode !== undefined) updateData.labour_code = updateLSRDto.labourCode;
    if (updateLSRDto.labourType !== undefined) updateData.labour_type = updateLSRDto.labourType;
    if (updateLSRDto.description !== undefined) updateData.description = updateLSRDto.description;
    if (updateLSRDto.minimumWagePerDay !== undefined) updateData.minimum_wage_per_day = updateLSRDto.minimumWagePerDay;
    if (updateLSRDto.minimumWagePerMonth !== undefined) updateData.minimum_wage_per_month = updateLSRDto.minimumWagePerMonth;
    if (updateLSRDto.dearnessAllowance !== undefined) updateData.dearness_allowance = updateLSRDto.dearnessAllowance;
    if (updateLSRDto.perksPercentage !== undefined) updateData.perks_percentage = updateLSRDto.perksPercentage;
    if (updateLSRDto.lhr !== undefined) updateData.lhr = updateLSRDto.lhr;
    if (updateLSRDto.reference !== undefined) updateData.reference = updateLSRDto.reference;
    if (updateLSRDto.location !== undefined) updateData.location = updateLSRDto.location;
    if (updateLSRDto.processGroup !== undefined) updateData.process_group = updateLSRDto.processGroup;
    if (updateLSRDto.machineName !== undefined) updateData.machine_name = updateLSRDto.machineName;
    if (updateLSRDto.machineDescription !== undefined) updateData.machine_description = updateLSRDto.machineDescription;
    if (updateLSRDto.manufacturer !== undefined) updateData.manufacturer = updateLSRDto.manufacturer;
    if (updateLSRDto.manufacturerCountry !== undefined) updateData.manufacturer_country = updateLSRDto.manufacturerCountry;
    if (updateLSRDto.wageGrade !== undefined) updateData.wage_grade = updateLSRDto.wageGrade;
    if (updateLSRDto.operators !== undefined) updateData.operators = updateLSRDto.operators;
    if (updateLSRDto.shiftsPerDay !== undefined) updateData.shifts_per_day = updateLSRDto.shiftsPerDay;
    if (updateLSRDto.hoursPerShift !== undefined) updateData.hours_per_shift = updateLSRDto.hoursPerShift;
    if (updateLSRDto.workingDaysPerYear !== undefined) updateData.working_days_per_year = updateLSRDto.workingDaysPerYear;
    if (updateLSRDto.totalHrsPerYear !== undefined) updateData.total_hrs_per_year = updateLSRDto.totalHrsPerYear;
    if (updateLSRDto.usdLaborRatePerHr !== undefined) updateData.usd_labor_rate_per_hr = updateLSRDto.usdLaborRatePerHr;
    if (updateLSRDto.usdLhrBase !== undefined) updateData.usd_lhr_base = updateLSRDto.usdLhrBase;
    if (updateLSRDto.usdLhrBurden !== undefined) updateData.usd_lhr_burden = updateLSRDto.usdLhrBurden;
    if (updateLSRDto.usdLhrTotal !== undefined) updateData.usd_lhr_total = updateLSRDto.usdLhrTotal;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating LSR record: ${error.message}`, 'LSRService');
      throw new InternalServerErrorException(`Failed to update LSR record: ${error.message}`);
    }

    return this.mapDatabaseToResponse(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting LSR record: ${id}`, 'LSRService');

    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid LSR record ID format');
    }

    // Verify record exists
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting LSR record: ${error.message}`, 'LSRService');
      throw new InternalServerErrorException(`Failed to delete LSR record: ${error.message}`);
    }

    return { message: 'LSR record deleted successfully' };
  }

  async bulkCreate(data: CreateLSRDto[], userId: string, accessToken: string) {
    this.logger.log(`Bulk creating ${data.length} LSR records`, 'LSRService');

    const records = data.map(dto => ({
      user_id: userId,
      labour_code: dto.labourCode,
      labour_type: dto.labourType,
      description: dto.description,
      minimum_wage_per_day: dto.minimumWagePerDay,
      minimum_wage_per_month: dto.minimumWagePerMonth,
      dearness_allowance: dto.dearnessAllowance,
      perks_percentage: dto.perksPercentage,
      lhr: dto.lhr,
      reference: dto.reference || null,
      location: dto.location || null,
      process_group: dto.processGroup || null,
      machine_name: dto.machineName || null,
      machine_description: dto.machineDescription || null,
      manufacturer: dto.manufacturer || null,
      manufacturer_country: dto.manufacturerCountry || null,
      wage_grade: dto.wageGrade || null,
      operators: dto.operators || null,
      shifts_per_day: dto.shiftsPerDay || null,
      hours_per_shift: dto.hoursPerShift || null,
      working_days_per_year: dto.workingDaysPerYear || null,
      total_hrs_per_year: dto.totalHrsPerYear || null,
      usd_labor_rate_per_hr: dto.usdLaborRatePerHr || null,
      usd_lhr_base: dto.usdLhrBase || null,
      usd_lhr_burden: dto.usdLhrBurden || null,
      usd_lhr_total: dto.usdLhrTotal || null,
    }));

    const { data: inserted, error } = await this.supabaseService
      .getClient(accessToken)
      .from('lsr_records')
      .insert(records)
      .select();

    if (error) {
      this.logger.error(`Error bulk creating LSR records: ${error.message}`, 'LSRService');
      throw new InternalServerErrorException(`Failed to bulk create LSR records: ${error.message}`);
    }

    return (inserted || []).map(row => this.mapDatabaseToResponse(row));
  }

  async importFromExcel(
    fileBuffer: Buffer,
    userId: string,
    accessToken: string,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    this.logger.log(`Importing LHR records from Excel for user ${userId}`, 'LSRService');

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength,
    ) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);

    const toNum = (v: ExcelJS.CellValue, fallback: number): number => {
      if (v == null) return fallback;
      const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? fallback : n;
    };
    const toStr = (v: ExcelJS.CellValue, fallback = ''): string =>
      v != null ? String(v).trim() : fallback;

    // Indian standard wages from lhr-db.csv (281 days × 1 shift × 8 hrs = 2248 hrs/year)
    const WORKING_HOURS_PER_YEAR = 2248;
    const calcLHR = (monthWage: number, da: number, perks: number) =>
      parseFloat(((monthWage + da) * (1 + perks / 100) * 12 / WORKING_HOURS_PER_YEAR).toFixed(2));

    const GRADE_DEFAULTS: Record<string, { type: string; wagePerDay: number; wagePerMonth: number; da: number; perks: number }> = {
      '1':  { type: 'Unskilled',      wagePerDay: 500,   wagePerMonth: 15000, da: 0, perks: 30 },
      '2':  { type: 'Unskilled',      wagePerDay: 500,   wagePerMonth: 15000, da: 0, perks: 30 },
      '3':  { type: 'Semi-Skilled',   wagePerDay: 557.5, wagePerMonth: 16725, da: 0, perks: 30 },
      '5':  { type: 'Skilled',        wagePerDay: 634.5, wagePerMonth: 19035, da: 0, perks: 30 },
      '7':  { type: 'Skilled',        wagePerDay: 700,   wagePerMonth: 21000, da: 0, perks: 30 },
      '9':  { type: 'Highly Skilled', wagePerDay: 800,   wagePerMonth: 24000, da: 0, perks: 30 },
      '11': { type: 'Highly Skilled', wagePerDay: 900,   wagePerMonth: 27000, da: 0, perks: 30 },
      '13': { type: 'Highly Skilled', wagePerDay: 1000,  wagePerMonth: 30000, da: 0, perks: 30 },
    };

    // Sheet candidates: named LHR sheets first, then REF_SKILL_LEVELS
    const namedSheet = workbook.worksheets.find(ws =>
      ['lhr', 'labour hour rate', 'labour hour rates', 'lsr', 'labor hour rate'].includes(ws.name.toLowerCase().trim())
    );
    const skillSheet = workbook.worksheets.find(ws => ws.name.trim() === 'REF_SKILL_LEVELS');
    const sheet = namedSheet ?? skillSheet;

    if (!sheet) {
      this.logger.log('No LHR sheet found in Excel file — skipping LHR import', 'LSRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    const rows: any[] = [];

    // ── REF_SKILL_LEVELS path: auto-generate from grade data + Indian wage defaults ──
    if (!namedSheet && sheet.name.trim() === 'REF_SKILL_LEVELS') {
      this.logger.log('Using REF_SKILL_LEVELS sheet with auto-calculated Indian wage defaults', 'LSRService');

      let skipFirstRow = true;
      sheet.eachRow(row => {
        if (skipFirstRow) { skipFirstRow = false; return; } // skip column-header row

        const gradeVal = toStr(row.getCell(1).value);
        const rolesVal = toStr(row.getCell(2).value);

        // Skip sub-header row ("Grade", "Typical_Roles") and empty rows
        if (!gradeVal || gradeVal.toLowerCase() === 'grade') return;

        const gradeNum = gradeVal.replace(/[^0-9]/g, '');
        const defaults = GRADE_DEFAULTS[gradeNum];
        if (!defaults) return;

        const lhr = calcLHR(defaults.wagePerMonth, defaults.da, defaults.perks);

        rows.push({
          user_id:               userId,
          labour_code:           `GR-${gradeNum.padStart(2, '0')}-L`,
          labour_type:           defaults.type,
          description:           rolesVal || null,
          minimum_wage_per_day:  defaults.wagePerDay,
          minimum_wage_per_month: defaults.wagePerMonth,
          dearness_allowance:    defaults.da,
          perks_percentage:      defaults.perks,
          lhr,
          location:              'India - Manufacturing Standard',
          reference:             `aPriori ${gradeVal} — auto-calculated at ${WORKING_HOURS_PER_YEAR} hrs/yr`,
        });
      });
    } else {
      // ── Standard tabular LHR sheet path ──
      const colMap: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell, colNum) => {
        const h = toStr(cell.value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (h) colMap[h] = colNum;
      });
      const getCol = (...keys: string[]): number | null => {
        for (const k of keys) if (colMap[k] !== undefined) return colMap[k];
        return null;
      };

      const wageGradeToType = (grade: string): string => {
        const n = parseInt(grade.replace(/[^0-9]/g, ''), 10);
        if (n <= 3) return 'Unskilled';
        if (n <= 7) return 'Semi-Skilled';
        if (n <= 9) return 'Skilled';
        return 'Highly Skilled';
      };

      const labourCodeCol       = getCol('labour code', 'labor code');
      const slNoCol             = getCol('sl no', 'serial no', 'sr no', 's no');
      const labourTypeCol       = getCol('labour type', 'labor type');
      const descCol             = getCol('description', 'machine description', 'machine_description');
      const wageDayCol          = getCol('min wage basis day', 'min wage day', 'minimum wage day', 'min_wage_inr_per_day');
      const wageMonthCol        = getCol('min wage month', 'minimum wage month', 'min_wage_inr_per_month');
      const daCol               = getCol('da', 'dearness allowance', 'd a');
      const perksCol            = getCol('perks', 'perks_pct');
      const lhrCol              = getCol('lhr hour', 'lhr', 'lhr_inr_per_hour', 'lhr inr hr');
      const locationCol         = getCol('location');
      const referenceCol        = getCol('reference');
      // India 2026 extended columns
      const processGroupCol     = getCol('process group', 'process_group');
      const machineNameCol2     = getCol('machine name', 'machine_name');
      const machineDescCol2     = getCol('machine description', 'machine_description');
      const manufacturerCol2    = getCol('manufacturer');
      const mfrCountryCol2      = getCol('manufacturer country', 'manufacturer_country');
      const wageGradeCol2       = getCol('wage grade', 'wage_grade');
      const operatorsCol2       = getCol('operators');
      const shiftsCol2          = getCol('shifts per day', 'shifts day', 'shifts_per_day');
      const hoursCol2           = getCol('hours per shift', 'hours shift', 'hours_per_shift');
      const daysCol2            = getCol('working days year', 'working days per year', 'working_days_per_year');
      const totalHrsCol2        = getCol('total hrs year', 'total hrs per year', 'total_hrs_per_year');
      const usdRateCol          = getCol('labor rate usd hr person', 'labor rate usd hr', 'usd labor rate', 'labor_rate_usd_per_hr_person');
      const usdBaseCol          = getCol('lhr base usd hr', 'usd lhr base', 'lhr_base_usd_per_hr');
      const usdBurdenCol        = getCol('lhr burden 38 usd hr', 'usd lhr burden', 'lhr_burden_38pct_usd_per_hr');
      const usdTotalCol         = getCol('lhr total usd hr', 'usd lhr total', 'lhr_total_usd_per_hr');

      let isHeaderRow = true;
      let currentLocation = 'India';

      sheet.eachRow(row => {
        if (isHeaderRow) { isHeaderRow = false; return; }

        let labourCodeVal: string;
        if (labourCodeCol) {
          const col1Val = toStr(row.getCell(1).value);
          labourCodeVal = toStr(row.getCell(labourCodeCol).value);
          if (col1Val && !labourCodeVal) { currentLocation = col1Val; return; }
          if (!labourCodeVal) return;
        } else if (slNoCol) {
          const slRaw = toStr(row.getCell(slNoCol).value);
          const slNum = parseInt(slRaw, 10);
          if (!slRaw || isNaN(slNum)) return; // skip empty rows / sub-headers
          labourCodeVal = `LHR-${String(slNum).padStart(4, '0')}`;
        } else {
          const machName = machineNameCol2 ? toStr(row.getCell(machineNameCol2).value) : '';
          if (!machName) return;
          labourCodeVal = machName.substring(0, 50);
        }

        const monthWage = wageMonthCol ? toNum(row.getCell(wageMonthCol).value, 0) : 0;
        const da        = daCol ? toNum(row.getCell(daCol).value, 0) : 0;
        const perksRaw  = perksCol ? row.getCell(perksCol).value : null;
        const perks     = perksRaw != null
          ? parseFloat(String(perksRaw).replace(/[^0-9.-]/g, '')) || 30
          : 30;
        const lhrStored = lhrCol ? toNum(row.getCell(lhrCol).value, 0) : 0;
        const lhr = lhrStored > 0 ? lhrStored : calcLHR(monthWage, da, perks);
        const wageGradeVal = wageGradeCol2 ? toStr(row.getCell(wageGradeCol2).value) : '';

        rows.push({
          user_id:                userId,
          labour_code:            labourCodeVal,
          labour_type:            labourTypeCol
            ? toStr(row.getCell(labourTypeCol).value) || wageGradeToType(wageGradeVal)
            : wageGradeToType(wageGradeVal),
          description:            descCol ? toStr(row.getCell(descCol).value) || null : null,
          minimum_wage_per_day:   wageDayCol ? toNum(row.getCell(wageDayCol).value, 0) : 0,
          minimum_wage_per_month: monthWage,
          dearness_allowance:     da,
          perks_percentage:       perks,
          lhr,
          location:               locationCol ? toStr(row.getCell(locationCol).value, currentLocation) || currentLocation : currentLocation,
          reference:              referenceCol ? toStr(row.getCell(referenceCol).value) || null : null,
          // India 2026 extended fields
          process_group:          processGroupCol ? toStr(row.getCell(processGroupCol).value) || null : null,
          machine_name:           machineNameCol2 ? toStr(row.getCell(machineNameCol2).value) || null : null,
          machine_description:    machineDescCol2 ? toStr(row.getCell(machineDescCol2).value) || null : null,
          manufacturer:           manufacturerCol2 ? toStr(row.getCell(manufacturerCol2).value) || null : null,
          manufacturer_country:   mfrCountryCol2 ? toStr(row.getCell(mfrCountryCol2).value) || null : null,
          wage_grade:             wageGradeVal || null,
          operators:              operatorsCol2 ? Math.max(1, toNum(row.getCell(operatorsCol2).value, 1)) : 1,
          shifts_per_day:         shiftsCol2 ? toNum(row.getCell(shiftsCol2).value, 0) || null : null,
          hours_per_shift:        hoursCol2 ? toNum(row.getCell(hoursCol2).value, 0) || null : null,
          working_days_per_year:  daysCol2 ? toNum(row.getCell(daysCol2).value, 0) || null : null,
          total_hrs_per_year:     totalHrsCol2 ? toNum(row.getCell(totalHrsCol2).value, 0) || null : null,
          usd_labor_rate_per_hr:  usdRateCol ? toNum(row.getCell(usdRateCol).value, 0) || null : null,
          usd_lhr_base:           usdBaseCol ? toNum(row.getCell(usdBaseCol).value, 0) || null : null,
          usd_lhr_burden:         usdBurdenCol ? toNum(row.getCell(usdBurdenCol).value, 0) || null : null,
          usd_lhr_total:          usdTotalCol ? toNum(row.getCell(usdTotalCol).value, 0) || null : null,
        });
      });
    }

    if (rows.length === 0) {
      this.logger.log('No valid LHR rows found — skipping', 'LSRService');
      return { imported: 0, skipped: 0, errors: [] };
    }

    const client = this.supabaseService.getClient(accessToken);

    // Pre-dedup: fetch existing labour codes for this user and filter them out
    const { data: existing } = await client
      .from('lsr_records')
      .select('labour_code')
      .eq('user_id', userId);
    const existingCodes = new Set((existing ?? []).map((r: any) => r.labour_code as string));

    const newRows = rows.filter(r => !existingCodes.has(r.labour_code as string));
    const skipped = rows.length - newRows.length;

    if (newRows.length === 0) {
      this.logger.log(`LHR import complete: 0 imported, ${skipped} skipped`, 'LSRService');
      return { imported: 0, skipped, errors: [] };
    }

    let imported = 0;
    const errors: string[] = [];
    const CHUNK_SIZE = 200;

    for (let offset = 0; offset < newRows.length; offset += CHUNK_SIZE) {
      const chunk = newRows.slice(offset, offset + CHUNK_SIZE);
      const { data, error } = await client
        .from('lsr_records')
        .insert(chunk)
        .select('id');
      if (error) {
        this.logger.error(`LSR import chunk error at offset ${offset}: ${error.message}`, 'LSRService');
        errors.push(`Batch at offset ${offset} failed: ${error.message}`);
      } else {
        imported += (data ?? []).length;
      }
    }

    this.logger.log(`LHR import complete: ${imported} imported, ${skipped} skipped`, 'LSRService');
    return { imported, skipped, errors };
  }

  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
  }

  private mapDatabaseToResponse(row: any) {
    return {
      id: row.id,
      labourCode: row.labour_code,
      labourType: row.labour_type,
      description: row.description,
      minimumWagePerDay: parseFloat(row.minimum_wage_per_day),
      minimumWagePerMonth: parseFloat(row.minimum_wage_per_month),
      dearnessAllowance: parseFloat(row.dearness_allowance),
      perksPercentage: parseFloat(row.perks_percentage),
      lhr: parseFloat(row.lhr),
      reference: row.reference,
      location: row.location,
      // India 2026 extended fields
      processGroup: row.process_group ?? undefined,
      machineName: row.machine_name ?? undefined,
      machineDescription: row.machine_description ?? undefined,
      manufacturer: row.manufacturer ?? undefined,
      manufacturerCountry: row.manufacturer_country ?? undefined,
      wageGrade: row.wage_grade ?? undefined,
      operators: row.operators ?? undefined,
      shiftsPerDay: row.shifts_per_day ? parseFloat(row.shifts_per_day) : undefined,
      hoursPerShift: row.hours_per_shift ? parseFloat(row.hours_per_shift) : undefined,
      workingDaysPerYear: row.working_days_per_year ? parseFloat(row.working_days_per_year) : undefined,
      totalHrsPerYear: row.total_hrs_per_year ? parseFloat(row.total_hrs_per_year) : undefined,
      usdLaborRatePerHr: row.usd_labor_rate_per_hr ? parseFloat(row.usd_labor_rate_per_hr) : undefined,
      usdLhrBase: row.usd_lhr_base ? parseFloat(row.usd_lhr_base) : undefined,
      usdLhrBurden: row.usd_lhr_burden ? parseFloat(row.usd_lhr_burden) : undefined,
      usdLhrTotal: row.usd_lhr_total ? parseFloat(row.usd_lhr_total) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
