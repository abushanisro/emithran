interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { RawMaterialsService } from './raw-materials.service';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from './dto/raw-materials.dto';
import { MaterialShape } from './constants/material-categories.constants';
import { RawMaterialResponseDto, RawMaterialListResponseDto } from './dto/raw-material-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { Public } from '../../common/decorators/public.decorator';
import * as ExcelJS from 'exceljs';

@ApiTags('Raw Materials')
@ApiBearerAuth()
@Controller({ path: 'api/raw-materials', version: '1' })
export class RawMaterialsController {
  private readonly logger = new Logger(RawMaterialsController.name);

  constructor(private readonly rawMaterialsService: RawMaterialsService) { }

  @Get()
  @ApiOperation({ summary: 'Get all raw materials' })
  @ApiResponse({ status: 200, description: 'Raw materials retrieved successfully', type: RawMaterialListResponseDto })
  async findAll(@Query() query: QueryRawMaterialsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialListResponseDto> {
    return this.rawMaterialsService.findAll(query, user.id, token);
  }

  @Get('filter-options')
  @ApiOperation({ summary: 'Get unique filter options for raw materials' })
  @ApiResponse({ status: 200, description: 'Filter options retrieved successfully' })
  async getFilterOptions(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.rawMaterialsService.getFilterOptions(user.id, token);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Get available material categories' })
  @ApiResponse({ status: 200, description: 'Material categories retrieved successfully' })
  async getMaterialCategories() {
    return this.rawMaterialsService.getMaterialCategories();
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Get material category statistics' })
  @ApiResponse({ status: 200, description: 'Category statistics retrieved successfully' })
  async getCategoryStatistics(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.rawMaterialsService.getMaterialCategoryStatistics(user.id, token);
  }

  @Get('plastic-rubber')
  @ApiOperation({ summary: 'Get plastic and rubber materials' })
  @ApiResponse({ status: 200, description: 'Plastic & rubber materials retrieved successfully', type: RawMaterialListResponseDto })
  async getPlasticRubberMaterials(@Query() query: QueryRawMaterialsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialListResponseDto> {
    return this.rawMaterialsService.getPlasticRubberMaterials(query, user.id, token);
  }

  @Get('ferrous')
  @ApiOperation({ summary: 'Get ferrous materials' })
  @ApiResponse({ status: 200, description: 'Ferrous materials retrieved successfully', type: RawMaterialListResponseDto })
  async getFerrousMaterials(@Query() query: QueryRawMaterialsDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialListResponseDto> {
    return this.rawMaterialsService.getFerrousMaterials(query, user.id, token);
  }

  @Post('plastic-rubber')
  @ApiOperation({ summary: 'Create a new plastic or rubber material' })
  @ApiResponse({ status: 201, description: 'Plastic/rubber material created successfully', type: RawMaterialResponseDto })
  async createPlasticRubberMaterial(@Body() createDto: CreateRawMaterialDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialResponseDto> {
    return this.rawMaterialsService.createPlasticRubberMaterial(createDto, user.id, token);
  }

  @Post('ferrous')
  @ApiOperation({ summary: 'Create a new ferrous material' })
  @ApiResponse({ status: 201, description: 'Ferrous material created successfully', type: RawMaterialResponseDto })
  async createFerrousMaterial(@Body() createDto: CreateRawMaterialDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialResponseDto> {
    return this.rawMaterialsService.createFerrousMaterial(createDto, user.id, token);
  }

  @Post('ferrous/import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import ferrous materials from Excel file' })
  @ApiResponse({ status: 201, description: 'Ferrous materials imported successfully' })
  async importFerrousFromExcel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string
  ) {
    if (!file) {
      throw new BadRequestException('Excel file is required');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as any);
    const worksheet = workbook.getWorksheet(1);

    if (!worksheet) {
      throw new BadRequestException('No worksheet found in Excel file');
    }

    const data: any[] = [];
    const headers: string[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell) => {
          headers.push(cell.text);
        });
      } else {
        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber - 1];
          if (header) {
            rowData[header] = cell.value;
          }
        });
        if (Object.keys(rowData).length > 0) {
          data.push(rowData);
        }
      }
    });

    return this.rawMaterialsService.importFerrousDataFromExcel(data, user.id, token);
  }

  @Get('grouped')
  @ApiOperation({ summary: 'Get raw materials grouped by material group' })
  @ApiResponse({ status: 200, description: 'Grouped materials retrieved successfully' })
  async getGrouped(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.rawMaterialsService.getGroupedByMaterialGroup(user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get raw material by ID' })
  @ApiResponse({ status: 200, description: 'Raw material retrieved successfully', type: RawMaterialResponseDto })
  @ApiResponse({ status: 404, description: 'Raw material not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialResponseDto> {
    return this.rawMaterialsService.findOne(id, user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create new raw material' })
  @ApiResponse({ status: 201, description: 'Raw material created successfully', type: RawMaterialResponseDto })
  async create(@Body() createRawMaterialDto: CreateRawMaterialDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialResponseDto> {
    return this.rawMaterialsService.create(createRawMaterialDto, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update raw material' })
  @ApiResponse({ status: 200, description: 'Raw material updated successfully', type: RawMaterialResponseDto })
  async update(@Param('id') id: string, @Body() updateRawMaterialDto: UpdateRawMaterialDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<RawMaterialResponseDto> {
    return this.rawMaterialsService.update(id, updateRawMaterialDto, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete raw material' })
  @ApiResponse({ status: 200, description: 'Raw material deleted successfully' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.rawMaterialsService.remove(id, user.id, token);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete all raw materials for current user' })
  @ApiResponse({ status: 200, description: 'All raw materials deleted successfully' })
  async removeAll(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.rawMaterialsService.removeAll(user.id, token);
  }

  @Post('upload-excel')
  @ApiOperation({ summary: 'Upload Excel file to bulk import raw materials' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Excel file processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or data' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ): Promise<{ message: string; created: number; failed: number; errors?: any[] }> {
    this.logger.log(`Upload request received: ${file?.originalname || 'No file'}`, 'RawMaterialsController');

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Validate file type
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
    ];

    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV file');
    }

    try {
      // Parse Excel file using ExcelJS
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);
      
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new BadRequestException('Excel file has no worksheets');
      }

      // Helper function to find the header row
      const findHeaderRow = (): number => {
        // Try reading first 5 rows to find where headers are
        for (let rowIndex = 1; rowIndex <= Math.min(5, worksheet.rowCount); rowIndex++) {
          const row = worksheet.getRow(rowIndex);
          const values = row.values as any[];
          
          if (!values || values.length === 0) continue;

          const validHeaders = values.filter(cell =>
            cell && typeof cell === 'string' &&
            (cell.toLowerCase().includes('material') ||
              cell.toLowerCase().includes('group') ||
              cell.toLowerCase().includes('grade') ||
              cell.toLowerCase().includes('location') ||
              cell.toLowerCase().includes('density') ||
              cell.toLowerCase().includes('temp'))
          );

          // If we found at least 2 material-related headers, this is likely the header row
          if (validHeaders.length >= 2) {
            return rowIndex;
          }
        }

        return 1; // Default to first row if nothing found
      };

      const headerRowIndex = findHeaderRow();
      const headerRow = worksheet.getRow(headerRowIndex);
      const headers = headerRow.values as any[];

      // Convert worksheet data to JSON format
      const jsonData: any[] = [];
      for (let rowIndex = headerRowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex++) {
        const row = worksheet.getRow(rowIndex);
        const values = row.values as any[];
        
        if (!values || values.length === 0) continue;

        const rowData: any = {};
        headers.forEach((header, colIndex) => {
          if (header && colIndex > 0) { // Skip index 0 as it's usually empty in ExcelJS
            rowData[header] = values[colIndex] || '';
          }
        });

        // Only add rows that have some data
        if (Object.values(rowData).some(value => value && value.toString().trim())) {
          jsonData.push(rowData);
        }
      }

      if (!jsonData || jsonData.length === 0) {
        throw new BadRequestException('Excel file is empty or has no data rows after headers');
      }

      // Validate that we have proper headers
      const finalRowKeys = Object.keys(jsonData[0]);
      if (finalRowKeys.length === 0) {
        throw new BadRequestException(
          `Invalid Excel format: No column headers found. ` +
          `Please ensure your Excel file has a header row with column names like "MaterialGroup", "Material", etc.`
        );
      }

      // Log first row for debugging column names
      if (jsonData.length > 0) {
        this.logger.debug('Excel columns found:', Object.keys(jsonData[0]), 'RawMaterialsController');
        this.logger.debug('First row sample data:', JSON.stringify(jsonData[0], null, 2), 'RawMaterialsController');
      }

      // Helper function to safely get column value with multiple possible names
      const getColumnValue = (row: any, ...columnNames: string[]): any => {
        for (const name of columnNames) {
          if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
            return row[name];
          }
        }
        return undefined;
      };

      // Helper function to parse numeric value
      const parseNumeric = (value: any): number | undefined => {
        if (value === undefined || value === null || value === '') return undefined;
        const str = String(value).replace(/[%,]/g, '').trim();
        const num = parseFloat(str);
        return isNaN(num) ? undefined : num;
      };

      // Helper function to map shape values from Excel to MaterialShape enum
      const mapShapeValue = (value: any): MaterialShape | undefined => {
        if (!value) return undefined;
        const shapeStr = String(value).toLowerCase().trim();
        
        // Map common Excel shape values to our enum values
        const shapeMapping: Record<string, MaterialShape> = {
          'granules': MaterialShape.GRANULES,
          'pellets': MaterialShape.PELLETS, 
          'powder': MaterialShape.POWDER,
          'flakes': MaterialShape.FLAKES,
          'sheets': MaterialShape.SHEETS,
          'rods': MaterialShape.RODS,
          'tubes': MaterialShape.TUBES,
          'profiles': MaterialShape.PROFILES,
          'ingots': MaterialShape.INGOTS,
          'bars': MaterialShape.BARS,
          'plates': MaterialShape.PLATES,
          'coils': MaterialShape.COILS,
          'wire': MaterialShape.WIRE,
          'foam': MaterialShape.FOAM,
          'liquid': MaterialShape.LIQUID,
        };
        
        return shapeMapping[shapeStr] || undefined;
      };

      // Collect valid materials for batch insert
      const validMaterials: CreateRawMaterialDto[] = [];
      const errors: any[] = [];

      // Process each row
      for (const [index, row] of jsonData.entries()) {
        try {
          const rowData: any = row;

          // Map Excel columns to DTO properties with comprehensive column name matching
          const rawMaterialGroup = getColumnValue(rowData, 'MaterialGroup', 'Material Group', 'material_group', 'MATERIALGROUP');
          
          // Map Excel material group values to system values
          const materialGroup = this.mapMaterialGroupFromExcel(rawMaterialGroup);
          
          // For plastic materials, MaterialGrade often contains the actual material name (like ABS)
          const material = getColumnValue(
            rowData, 
            'Material', 
            'MaterialDescription', 
            'Material Description', 
            'MaterialGrade',  // Add MaterialGrade as a potential material field
            'Material Grade',
            'material', 
            'material_description',
            'material_grade',
            'MATERIAL',
            'MATERIALDESCRIPTION',
            'MATERIALGRADE'
          );

          // Validate required fields first
          if (!materialGroup || !material) {
            const availableColumns = Object.keys(rowData).join(', ');
            const foundMaterialGroup = !!materialGroup;
            const foundMaterial = !!material;
            
            throw new Error(
              `Missing required fields. ` +
              `MaterialGroup: ${foundMaterialGroup ? '✓ Found' : '✗ Missing'}, ` +
              `Material: ${foundMaterial ? '✓ Found' : '✗ Missing (looking for MaterialDescription too)'}. ` +
              `Available columns: ${availableColumns}`
            );
          }

          // Extract specific heat and thermal conductivity with logging
          // Note: Adding exact column names from user's Excel including mangled encodings
          const specificHeatRaw = getColumnValue(
            rowData,
            'Specific Heat of Melt (J / g * Ã\x82Â°C)', // Exact from Excel
            'Specific Heat of Melt',
            'Specific Heat of Melt (J / g * °C)',
            'Specific Heat of Melt (J / g * Â°C)',
            'Specific Heat of Melt (J / g * ÃÂ°C)',
            'SpecificHeatMelt',
            'specific_heat_melt',
            'Specific Heat',
            'Sp. Heat'
          );
          const thermalCondRaw = getColumnValue(
            rowData,
            'Thermal Conductivity of Melt (Watts / m * Ã\x82Â°C)', // Exact from Excel
            'Thermal Conductivity of Melt',
            'Thermal Conductivity of Melt (Watts / m * °C)',
            'Thermal Conductivity of Melt (Watts / m * Â°C)',
            'Thermal Conductivity of Melt (Watts / m * ÃÂ°C)',
            'ThermalConductivityMelt',
            'thermal_conductivity_melt',
            'Thermal Conductivity',
            'Thermal Cond.',
            'Thermal Cond'
          );

          // Log for first row to debug
          if (index === 0) {
            this.logger.debug('Row 1 extracted values:', 'RawMaterialsController');
            this.logger.debug(`  Specific Heat raw: ${specificHeatRaw}`, 'RawMaterialsController');
            this.logger.debug(`  Thermal Cond raw: ${thermalCondRaw}`, 'RawMaterialsController');
            this.logger.debug(`  Specific Heat parsed: ${parseNumeric(specificHeatRaw)}`, 'RawMaterialsController');
            this.logger.debug(`  Thermal Cond parsed: ${parseNumeric(thermalCondRaw)}`, 'RawMaterialsController');
          }

          const createDto: CreateRawMaterialDto = {
            materialGroup,
            material,
            materialGrade: getColumnValue(
              rowData, 
              'Grade',
              'Type',
              'MaterialType',
              'Material Type',
              'material_type',
              'Subtype',
              'Category'
            ),
            regrinding: this.convertBooleanToYesNo(getColumnValue(rowData, 'Regrinding', 'regrinding', 'REGRINDING')),
            regrindingPercentage: parseNumeric(getColumnValue(rowData, 'Regrinding%', 'Regrinding Percentage', 'regrinding_percentage', 'RegrindingPercentage')),
            clampingPressureMpa: parseNumeric(getColumnValue(rowData, 'Clamping Pressure (MPa)', 'ClampingPressureMpa', 'clamping_pressure_mpa', 'Clamping Pressure', 'Clamp Pressure (MPa)', 'Clamp Pressure')),
            ejectDeflectionTempC: parseNumeric(getColumnValue(rowData, 'Eject Deflection Temp (Â°C)', 'Eject Deflection Temp (°C)', 'Eject Temp (Â°C)', 'Eject Temp (°C)', 'EjectDeflectionTempC', 'eject_deflection_temp_c', 'Eject Temp')),
            meltingTempC: parseNumeric(getColumnValue(rowData, 'Melting Temp (Â°C)', 'Melting Temp (°C)', 'Melt Temp (Â°C)', 'Melt Temp (°C)', 'MeltingTempC', 'melting_temp_c', 'Melting Temperature', 'Melt Temp')),
            moldTempC: parseNumeric(getColumnValue(rowData, 'Mold Temp (Â°C)', 'Mold Temp (°C)', 'MoldTempC', 'mold_temp_c', 'Mold Temperature')),
            densityKgM3: parseNumeric(getColumnValue(
              rowData, 
              'Density (kg / m^3)', 
              'Density (kg/m³)', 
              'Density (kg/mÂ³)', 
              'DensityKgM3', 
              'density_kg_m3', 
              'Density',
              'DENSITY'
            )),
            specificHeatMelt: parseNumeric(specificHeatRaw),
            thermalConductivityMelt: parseNumeric(thermalCondRaw),
            cost: parseNumeric(getColumnValue(rowData, 'Unit Cost ($)', 'Unit Cost', 'Cost', 'cost', 'COST', 'unit_cost', 'UnitCost')),
            
            // New material properties mapping with extensive column name matching
            density: parseNumeric(getColumnValue(rowData, 'Density', 'density', 'DENSITY', 'Density (g/cm³)', 'Density g/cm³')),
            ultimate_tensile_strength: parseNumeric(getColumnValue(rowData, 'UltimateTensileStrength', 'Ultimate Tensile Strength', 'UTS', 'UTS MPa', 'ultimate_tensile_strength', 'UTS_MPa')),
            yield_tensile_strength: parseNumeric(getColumnValue(rowData, 'YeildTensileStrength', 'Yield Tensile Strength', 'YTS', 'YTS MPa', 'yield_tensile_strength', 'YTS_MPa')),
            shearing_strength: parseNumeric(getColumnValue(rowData, 'ShearingStrength', 'Shearing Strength', 'Shear', 'Shear MPa', 'shearing_strength', 'Shear_MPa')),
            astm_standard: getColumnValue(rowData, 'ASTM Standard', 'ASTM_Standard', 'astm_standard', 'ASTM', 'ASTMStandard'),
            din_standard: getColumnValue(rowData, 'DIN Standard', 'DIN_Standard', 'din_standard', 'DIN', 'DINStandard'),
            en_standard: getColumnValue(rowData, 'EN Standard', 'EN_Standard', 'en_standard', 'EN', 'ENStandard'),
            jis_standard: getColumnValue(rowData, 'JIS Standard', 'JIS_Standard', 'jis_standard', 'JIS', 'JISStandard'),
            shape: mapShapeValue(getColumnValue(rowData, 'Shape', 'shape', 'SHAPE')),
          };

          // Add to valid materials array for batch insert
          validMaterials.push(createDto);

          // Log progress every 50 rows
          if ((index + 1) % 50 === 0) {
            this.logger.debug(`Processed ${index + 1} rows...`, 'RawMaterialsController');
          }
        } catch (error) {
          // Properly serialize error with all details
          const errorDetail = {
            row: index + 2, // +2 because Excel is 1-indexed and has header row
            message: error?.message || String(error),
            type: error?.name || 'Error',
            stack: error?.stack?.split('\n').slice(0, 3).join('\n'), // First 3 lines of stack
            columns: Object.keys(row),
            sampleData: {
              MaterialGroup: getColumnValue(row, 'MaterialGroup', 'Material Group'),
              Material: getColumnValue(row, 'Material'),
              Grade: getColumnValue(row, 'MaterialGrade', 'Material Grade', 'Grade'),
            },
          };

          errors.push(errorDetail);

          // Log first 5 errors with details
          if (errors.length <= 5) {
            // Error details tracked for row processing
          }
        }
      }

      this.logger.log(`Validation complete: ${validMaterials.length} valid, ${errors.length} failed`, 'RawMaterialsController');

      // Batch insert all valid materials
      let created = 0;
      if (validMaterials.length > 0) {
        this.logger.log(`Starting batch insert of ${validMaterials.length} materials...`, 'RawMaterialsController');
        try {
          created = await this.rawMaterialsService.createBatch(validMaterials, user.id, token);
          this.logger.log(`Batch insert complete: ${created} materials created`, 'RawMaterialsController');
        } catch (error) {
          this.logger.error(`Batch insert failed: ${error.message}`, 'RawMaterialsController');
          throw new BadRequestException(`Batch insert failed: ${error.message}`);
        }
      }

      const failed = errors.length;

      this.logger.log(`Upload complete: ${created} created, ${failed} failed out of ${jsonData.length} total rows`, 'RawMaterialsController');

      if (failed > 0) {
        this.logger.debug(`Failed rows: ${errors.map(e => e.row).join(', ')}`, 'RawMaterialsController');
      }

      return {
        message: `Excel file processed: ${created} materials created, ${failed} failed`,
        created,
        failed,
        errors: failed > 0 ? errors : undefined,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process Excel file: ${error.message}`);
    }
  }

  /**
   * Converts boolean values from Excel to Yes/No strings for database constraints
   */
  private convertBooleanToYesNo(value: any): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    
    const str = String(value).toLowerCase().trim();
    
    // Handle boolean true/false values
    if (value === true || str === 'true' || str === '1' || str === 'yes') {
      return 'Yes';
    }
    
    if (value === false || str === 'false' || str === '0' || str === 'no') {
      return 'No';
    }
    
    // Return original string if it's already in correct format
    if (str === 'yes' || str === 'no') {
      return str.charAt(0).toUpperCase() + str.slice(1);
    }
    
    // Default to undefined for invalid values
    return undefined;
  }

  /**
   * Maps Excel material group values to system material group values
   */
  private mapMaterialGroupFromExcel(excelMaterialGroup: string): string {
    if (!excelMaterialGroup) {
      return '';
    }

    const lowerGroup = excelMaterialGroup.toLowerCase().trim();

    // Map Excel values to PLASTIC & RUBBER materials
    if (lowerGroup.includes('plastic') || 
        lowerGroup.includes('rubber') || 
        lowerGroup.includes('polymer') || 
        lowerGroup.includes('elastomer') ||
        lowerGroup === 'plastics' ||
        lowerGroup === 'plastic' ||
        lowerGroup.includes('thermoplastic') ||
        lowerGroup.includes('abs') ||
        lowerGroup.includes('pvc') ||
        lowerGroup.includes('pe') ||
        lowerGroup.includes('pp')) {
      return 'Plastic & Rubber';
    }

    // Map Excel values to FERROUS & NON-FERROUS materials  
    if (lowerGroup.includes('ferrous') || 
        lowerGroup.includes('steel') || 
        lowerGroup.includes('iron') || 
        lowerGroup.includes('metal') ||
        lowerGroup.includes('aluminum') ||
        lowerGroup.includes('copper') ||
        lowerGroup.includes('titanium') ||
        lowerGroup.includes('zinc') ||
        lowerGroup.includes('brass') ||
        lowerGroup.includes('bronze') ||
        lowerGroup === 'ferrous' ||
        lowerGroup === 'metals' ||
        lowerGroup === 'alloy' ||
        lowerGroup.includes('stainless')) {
      return 'Ferrous & Non-Ferrous';
    }

    // If no mapping found, return the original value with proper case formatting
    return excelMaterialGroup.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}
