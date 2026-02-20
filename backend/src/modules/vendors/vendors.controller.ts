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
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import {
  CreateVendorDto,
  UpdateVendorDto,
  QueryVendorsDto,
  CreateVendorEquipmentDto,
  UpdateVendorEquipmentDto,
  CreateVendorServiceDto,
  UpdateVendorServiceDto,
  CreateVendorContactDto,
  UpdateVendorContactDto,
} from './dto/vendor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Vendors')
@ApiBearerAuth()
@Controller({ path: 'api/vendors', version: '1' })
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  // ============================================================================
  // VENDOR ENDPOINTS
  // ============================================================================

  @Get()
  @ApiOperation({ summary: 'Get all vendors with advanced filtering' })
  @ApiResponse({ status: 200, description: 'Vendors retrieved successfully' })
  async findAll(@Query() query: QueryVendorsDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.findAll(query, user.id, token);
  }

  // ============================================================================
  // SPECIFIC ROUTES - Must come before parameterized routes
  // ============================================================================

  @Post('upload-csv')
  @ApiOperation({ summary: 'Upload vendors from CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Vendors imported successfully' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadCsv(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.vendorsService.importFromCsv(file, user.id, token);
  }

  @Get('equipment-types')
  @ApiOperation({ summary: 'Get all unique equipment types' })
  @ApiResponse({ status: 200, description: 'Equipment types retrieved successfully' })
  async getEquipmentTypes(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.getEquipmentTypes(user.id, token);
  }

  // ============================================================================
  // PARAMETERIZED ROUTES - Must come after specific routes
  // ============================================================================

  @Get(':id')
  @ApiOperation({ summary: 'Get vendor by ID' })
  @ApiResponse({ status: 200, description: 'Vendor retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.findOne(id, user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create new vendor' })
  @ApiResponse({ status: 201, description: 'Vendor created successfully' })
  async create(@Body() createVendorDto: CreateVendorDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.create(createVendorDto, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update vendor' })
  @ApiResponse({ status: 200, description: 'Vendor updated successfully' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() updateVendorDto: UpdateVendorDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.update(id, updateVendorDto, user.id, token);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete vendor' })
  @ApiResponse({ status: 200, description: 'Vendor deleted successfully' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.remove(id, user.id, token);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete all vendors' })
  @ApiResponse({ status: 200, description: 'All vendors deleted successfully' })
  async removeAll(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.removeAll(user.id, token);
  }

  // ============================================================================
  // VENDOR EQUIPMENT ENDPOINTS
  // ============================================================================

  @Get(':vendorId/equipment')
  @ApiOperation({ summary: 'Get equipment for a vendor' })
  @ApiResponse({ status: 200, description: 'Equipment retrieved successfully' })
  async findEquipment(@Param('vendorId', ParseUUIDPipe) vendorId: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.findEquipment(vendorId, user.id, token);
  }

  @Post('equipment')
  @ApiOperation({ summary: 'Add equipment to vendor' })
  @ApiResponse({ status: 201, description: 'Equipment created successfully' })
  async createEquipment(@Body() createEquipmentDto: CreateVendorEquipmentDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.createEquipment(createEquipmentDto, user.id, token);
  }

  @Put('equipment/:id')
  @ApiOperation({ summary: 'Update equipment' })
  @ApiResponse({ status: 200, description: 'Equipment updated successfully' })
  @ApiResponse({ status: 404, description: 'Equipment not found' })
  async updateEquipment(@Param('id') id: string, @Body() updateEquipmentDto: UpdateVendorEquipmentDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.updateEquipment(id, updateEquipmentDto, user.id, token);
  }

  @Delete('equipment/:id')
  @ApiOperation({ summary: 'Delete equipment' })
  @ApiResponse({ status: 200, description: 'Equipment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Equipment not found' })
  async removeEquipment(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.removeEquipment(id, user.id, token);
  }

  // ============================================================================
  // VENDOR SERVICES ENDPOINTS
  // ============================================================================

  @Get(':vendorId/services')
  @ApiOperation({ summary: 'Get services for a vendor' })
  @ApiResponse({ status: 200, description: 'Services retrieved successfully' })
  async findServices(@Param('vendorId', ParseUUIDPipe) vendorId: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.findServices(vendorId, user.id, token);
  }

  @Post('services')
  @ApiOperation({ summary: 'Add service to vendor' })
  @ApiResponse({ status: 201, description: 'Service created successfully' })
  async createService(@Body() createServiceDto: CreateVendorServiceDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.createService(createServiceDto, user.id, token);
  }

  @Put('services/:id')
  @ApiOperation({ summary: 'Update service' })
  @ApiResponse({ status: 200, description: 'Service updated successfully' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async updateService(@Param('id') id: string, @Body() updateServiceDto: UpdateVendorServiceDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.updateService(id, updateServiceDto, user.id, token);
  }

  @Delete('services/:id')
  @ApiOperation({ summary: 'Delete service' })
  @ApiResponse({ status: 200, description: 'Service deleted successfully' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async removeService(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.removeService(id, user.id, token);
  }

  // ============================================================================
  // VENDOR CONTACTS ENDPOINTS
  // ============================================================================

  @Get(':vendorId/contacts')
  @ApiOperation({ summary: 'Get contacts for a vendor' })
  @ApiResponse({ status: 200, description: 'Contacts retrieved successfully' })
  async findContacts(@Param('vendorId', ParseUUIDPipe) vendorId: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.findContacts(vendorId, user.id, token);
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Add contact to vendor' })
  @ApiResponse({ status: 201, description: 'Contact created successfully' })
  async createContact(@Body() createContactDto: CreateVendorContactDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.createContact(createContactDto, user.id, token);
  }

  @Put('contacts/:id')
  @ApiOperation({ summary: 'Update contact' })
  @ApiResponse({ status: 200, description: 'Contact updated successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async updateContact(@Param('id') id: string, @Body() updateContactDto: UpdateVendorContactDto, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.updateContact(id, updateContactDto, user.id, token);
  }

  @Delete('contacts/:id')
  @ApiOperation({ summary: 'Delete contact' })
  @ApiResponse({ status: 200, description: 'Contact deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contact not found' })
  async removeContact(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    return this.vendorsService.removeContact(id, user.id, token);
  }
}
