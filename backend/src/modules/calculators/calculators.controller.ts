interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Post, Put, Delete, Body, Param, Query, Inject, forwardRef, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { CalculatorsServiceV2 } from './calculators.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import {
  CreateCalculatorDto,
  UpdateCalculatorDto,
  QueryCalculatorDto,
  ExecuteCalculatorDto,
  CreateFieldDto,
  UpdateFieldDto,
  CreateFormulaDto,
  UpdateFormulaDto
} from './dto/calculator.dto';

@ApiTags('Calculators')
@ApiBearerAuth()
@UseGuards(ThrottlerGuard)
@Controller({ path: 'api/calculators', version: '1' })
export class CalculatorsController {
  constructor(
    @Inject(forwardRef(() => CalculatorsServiceV2))
    private readonly calculatorsService: CalculatorsServiceV2
  ) { }

  @Get()
  @ApiOperation({ summary: 'Get all calculators' })
  @ApiResponse({ status: 200, description: 'Calculators retrieved successfully' })
  async findAll(
    @Query() query: QueryCalculatorDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.findAll(query, user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get calculator by ID' })
  @ApiResponse({ status: 200, description: 'Calculator retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Calculator not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.findOne(id, user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create new calculator' })
  @ApiResponse({ status: 201, description: 'Calculator created successfully' })
  async create(
    @Body() dto: CreateCalculatorDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.create(dto, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update calculator' })
  @ApiResponse({ status: 200, description: 'Calculator updated successfully' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCalculatorDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.update(id, dto, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete calculator' })
  @ApiResponse({ status: 200, description: 'Calculator deleted successfully' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.remove(id, user.id, token);
  }

  @Post(':id/execute')
  @ApiOperation({ summary: 'Execute calculator formulas' })
  @ApiResponse({ status: 200, description: 'Calculator executed successfully' })
  async execute(
    @Param('id') id: string,
    @Body() dto: ExecuteCalculatorDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.execute(id, dto, user.id, token);
  }

  // ========================================
  // FIELD ENDPOINTS
  // ========================================

  @Get(':id/fields')
  @ApiOperation({ summary: 'Get all fields for a calculator' })
  async getFields(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.getFields(id, user.id, token);
  }

  @Post(':id/fields')
  @ApiOperation({ summary: 'Add a new field to calculator' })
  async createField(
    @Param('id') id: string,
    @Body() dto: CreateFieldDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.createField(id, dto, user.id, token);
  }

  @Put(':id/fields/:fieldId')
  @ApiOperation({ summary: 'Update a specific field' })
  async updateField(
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateFieldDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.updateField(id, fieldId, dto, user.id, token);
  }

  @Delete(':id/fields/:fieldId')
  @ApiOperation({ summary: 'Remove a field from calculator' })
  async removeField(
    @Param('id') id: string,
    @Param('fieldId') fieldId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.removeField(id, fieldId, user.id, token);
  }

  // ========================================
  // FORMULA ENDPOINTS
  // ========================================

  @Get(':id/formulas')
  @ApiOperation({ summary: 'Get all formulas for a calculator' })
  async getFormulas(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.getFormulas(id, user.id, token);
  }

  @Post(':id/formulas')
  @ApiOperation({ summary: 'Add a new formula to calculator' })
  async createFormula(
    @Param('id') id: string,
    @Body() dto: CreateFormulaDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.createFormula(id, dto, user.id, token);
  }

  @Put(':id/formulas/:formulaId')
  @ApiOperation({ summary: 'Update a specific formula' })
  async updateFormula(
    @Param('id') id: string,
    @Param('formulaId') formulaId: string,
    @Body() dto: UpdateFormulaDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.updateFormula(id, formulaId, dto, user.id, token);
  }

  @Delete(':id/formulas/:formulaId')
  @ApiOperation({ summary: 'Remove a formula from calculator' })
  async removeFormula(
    @Param('id') id: string,
    @Param('formulaId') formulaId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.calculatorsService.removeFormula(id, formulaId, user.id, token);
  }
}
