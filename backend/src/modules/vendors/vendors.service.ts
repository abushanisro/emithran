import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
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
import { validate as isValidUUID } from 'uuid';

@Injectable()
export class VendorsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // ============================================================================
  // VENDOR CRUD
  // ============================================================================

  async findAll(query: QueryVendorsDto, userId: string, accessToken: string) {
    this.logger.log('Fetching all vendors from shared database', 'VendorsService');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100); // Cap at 100 for performance
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    // Shared database - all authenticated users see all vendors
    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('vendor_summary')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Apply search filter (search across name, city, state)
    if (query.search) {
      queryBuilder = queryBuilder.or(
        `name.ilike.%${query.search}%,city.ilike.%${query.search}%,state.ilike.%${query.search}%,supplier_code.ilike.%${query.search}%`
      );
    }

    // Apply status filter
    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }

    // Apply vendor type filter
    if (query.vendorType) {
      queryBuilder = queryBuilder.eq('vendor_type', query.vendorType);
    }

    // Apply location filters
    if (query.city) {
      queryBuilder = queryBuilder.eq('city', query.city);
    }
    if (query.state) {
      queryBuilder = queryBuilder.eq('state', query.state);
    }
    if (query.country) {
      queryBuilder = queryBuilder.eq('country', query.country);
    }

    // Apply process filter (array overlap)
    if (query.process && query.process.length > 0) {
      queryBuilder = queryBuilder.overlaps('process', query.process);
    }

    // Apply industries filter
    if (query.industries && query.industries.length > 0) {
      queryBuilder = queryBuilder.contains('industries', query.industries);
    }

    // Apply certifications filter
    if (query.certifications && query.certifications.length > 0) {
      queryBuilder = queryBuilder.contains('certifications', query.certifications);
    }

    // Pagination
    queryBuilder = queryBuilder.range(from, to);

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching vendors: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException('Unable to retrieve vendors. Please try again later.');
    }

    // If equipment filters are provided, filter vendors that have matching equipment
    let filteredData = data || [];
    if (query.equipmentType || query.minTonnage || query.maxTonnage || query.minBedLength || query.minBedWidth || query.minBedHeight) {
      const vendorIds = filteredData.map(v => v.id);
      if (vendorIds.length > 0) {
        const matchingVendorIds = await this.findVendorsWithMatchingEquipment(
          vendorIds,
          {
            equipmentType: query.equipmentType,
            minTonnage: query.minTonnage,
            maxTonnage: query.maxTonnage,
            minBedLength: query.minBedLength,
            minBedWidth: query.minBedWidth,
            minBedHeight: query.minBedHeight,
          },
          accessToken
        );
        filteredData = filteredData.filter(v => matchingVendorIds.includes(v.id));
      }
    }

    return {
      vendors: filteredData,
      total: count || 0,
      page,
      limit,
    };
  }

  private async findVendorsWithMatchingEquipment(
    vendorIds: string[],
    filters: {
      equipmentType?: string;
      minTonnage?: number;
      maxTonnage?: number;
      minBedLength?: number;
      minBedWidth?: number;
      minBedHeight?: number;
    },
    accessToken: string
  ): Promise<string[]> {
    let equipmentQuery = this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .select('vendor_id')
      .in('vendor_id', vendorIds);

    if (filters.equipmentType) {
      equipmentQuery = equipmentQuery.eq('equipment_type', filters.equipmentType);
    }

    if (filters.minTonnage !== undefined) {
      equipmentQuery = equipmentQuery.gte('tonnage', filters.minTonnage);
    }

    if (filters.maxTonnage !== undefined) {
      equipmentQuery = equipmentQuery.lte('tonnage', filters.maxTonnage);
    }

    if (filters.minBedLength !== undefined) {
      equipmentQuery = equipmentQuery.gte('bed_size_length_mm', filters.minBedLength);
    }

    if (filters.minBedWidth !== undefined) {
      equipmentQuery = equipmentQuery.gte('bed_size_width_mm', filters.minBedWidth);
    }

    if (filters.minBedHeight !== undefined) {
      equipmentQuery = equipmentQuery.gte('bed_size_height_mm', filters.minBedHeight);
    }

    const { data, error } = await equipmentQuery;

    if (error) {
      this.logger.error(`Error filtering by equipment: ${error.message}`, 'VendorsService');
      return vendorIds; // Return all if error to avoid blocking
    }

    return [...new Set(data?.map(e => e.vendor_id) || [])];
  }

  async findOne(id: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching vendor: ${id} from shared database`, 'VendorsService');

    // Validate UUID format
    if (!this.isValidUUID(id)) {
      this.logger.warn(`Invalid UUID format provided: ${id}`, 'VendorsService');
      throw new BadRequestException('Please provide a valid vendor ID.');
    }

    // Query vendors table directly to ensure we get the company_email field
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Vendor not found: ${id}`, 'VendorsService');
      throw new NotFoundException('The requested vendor could not be found.');
    }

    // Convert snake_case to camelCase for frontend consumption
    return this.convertToCamelCase(data);
  }

  /**
   * Validate UUID format to prevent invalid queries
   */
  private isValidUUID(id: string): boolean {
    try {
      return isValidUUID(id);
    } catch {
      return false;
    }
  }

  async create(createVendorDto: CreateVendorDto, userId: string, accessToken: string) {
    this.logger.log('Creating vendor', 'VendorsService');

    // Convert camelCase to snake_case for database
    const vendorData = this.convertToSnakeCase(createVendorDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .insert({
        ...vendorData,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating vendor: ${error.message}`, 'VendorsService');
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('vendors_supplier_code')) {
        throw new BadRequestException('This supplier code is already in use. Please use a different code.');
      }
      if (error.message.includes('duplicate key') && error.message.includes('vendors_name')) {
        throw new BadRequestException('A vendor with this name already exists. Please choose a different name.');
      }
      throw new InternalServerErrorException('Unable to create the vendor. Please try again later.');
    }

    return data;
  }

  async update(id: string, updateVendorDto: UpdateVendorDto, userId: string, accessToken: string) {
    this.logger.log(`Updating vendor: ${id} in shared database`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(id, userId, accessToken);

    // Convert camelCase to snake_case for database
    const vendorData = this.convertToSnakeCase(updateVendorDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .update(vendorData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating vendor: ${error.message}`, 'VendorsService');
      // Check for specific database errors
      if (error.message.includes('duplicate key') && error.message.includes('vendors_supplier_code')) {
        throw new BadRequestException('This supplier code is already in use. Please use a different code.');
      }
      if (error.message.includes('duplicate key') && error.message.includes('vendors_name')) {
        throw new BadRequestException('A vendor with this name already exists. Please choose a different name.');
      }
      throw new InternalServerErrorException('Unable to update the vendor. Please try again later.');
    }

    return data;
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting vendor: ${id} from shared database`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting vendor: ${error.message}`, 'VendorsService');
      // Check for specific database errors
      if (error.message.includes('foreign key') || error.message.includes('violates')) {
        throw new BadRequestException('Cannot delete this vendor because it is referenced by other data (equipment, services, contacts, etc.). Please remove all related data first.');
      }
      throw new InternalServerErrorException('Unable to delete the vendor. Please try again later.');
    }

    return { message: 'Vendor deleted successfully' };
  }

  async removeAll(userId: string, accessToken: string) {
    this.logger.log('Deleting all vendors from shared database (WARNING: affects all users)', 'VendorsService');

    // First get count of all vendors
    const { count } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .select('*', { count: 'exact', head: true });

    // Delete ALL vendors from shared database
    // WARNING: This affects all users in multi-tenant setup
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (dummy condition)

    if (error) {
      this.logger.error(`Error deleting all vendors: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to delete all vendors: ${error.message}`);
    }

    return {
      message: 'All vendors deleted successfully from shared database',
      deleted: count || 0
    };
  }

  // ============================================================================
  // VENDOR EQUIPMENT CRUD
  // ============================================================================

  async findEquipment(vendorId: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching equipment for vendor: ${vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(vendorId, userId, accessToken);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching equipment: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to fetch equipment: ${error.message}`);
    }

    return this.convertToCamelCase(data || []);
  }

  async createEquipment(createEquipmentDto: CreateVendorEquipmentDto, userId: string, accessToken: string) {
    this.logger.log(`Creating equipment for vendor: ${createEquipmentDto.vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(createEquipmentDto.vendorId, userId, accessToken);

    const equipmentData = this.convertToSnakeCase(createEquipmentDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .insert(equipmentData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating equipment: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to create equipment: ${error.message}`);
    }

    return this.convertToCamelCase(data);
  }

  async updateEquipment(id: string, updateEquipmentDto: UpdateVendorEquipmentDto, userId: string, accessToken: string) {
    this.logger.log(`Updating equipment: ${id} (shared database)`, 'VendorsService');

    // Verify equipment exists (shared database - no user check)
    const { data: equipment, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .select('id, vendor_id')
      .eq('id', id)
      .single();

    if (getError || !equipment) {
      throw new NotFoundException(`Equipment with ID ${id} not found`);
    }

    const equipmentData = this.convertToSnakeCase(updateEquipmentDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .update(equipmentData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating equipment: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to update equipment: ${error.message}`);
    }

    return this.convertToCamelCase(data);
  }

  async removeEquipment(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting equipment: ${id} (shared database)`, 'VendorsService');

    // Verify equipment exists (shared database - no user check)
    const { data: equipment, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .select('id')
      .eq('id', id)
      .single();

    if (getError || !equipment) {
      throw new NotFoundException(`Equipment with ID ${id} not found`);
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting equipment: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to delete equipment: ${error.message}`);
    }

    return { message: 'Equipment deleted successfully' };
  }

  // ============================================================================
  // VENDOR SERVICES CRUD
  // ============================================================================

  async findServices(vendorId: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching services for vendor: ${vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(vendorId, userId, accessToken);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching services: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to fetch services: ${error.message}`);
    }

    return data || [];
  }

  async createService(createServiceDto: CreateVendorServiceDto, userId: string, accessToken: string) {
    this.logger.log(`Creating service for vendor: ${createServiceDto.vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(createServiceDto.vendorId, userId, accessToken);

    const serviceData = this.convertToSnakeCase(createServiceDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .insert(serviceData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating service: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to create service: ${error.message}`);
    }

    return data;
  }

  async updateService(id: string, updateServiceDto: UpdateVendorServiceDto, userId: string, accessToken: string) {
    this.logger.log(`Updating service: ${id} (shared database)`, 'VendorsService');

    // Verify service exists (shared database - no user check)
    const { data: service, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .select('id, vendor_id')
      .eq('id', id)
      .single();

    if (getError || !service) {
      throw new NotFoundException(`Service with ID ${id} not found`);
    }

    const serviceData = this.convertToSnakeCase(updateServiceDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .update(serviceData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating service: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to update service: ${error.message}`);
    }

    return data;
  }

  async removeService(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting service: ${id} (shared database)`, 'VendorsService');

    // Verify service exists (shared database - no user check)
    const { data: service, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .select('id')
      .eq('id', id)
      .single();

    if (getError || !service) {
      throw new NotFoundException(`Service with ID ${id} not found`);
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_services')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting service: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to delete service: ${error.message}`);
    }

    return { message: 'Service deleted successfully' };
  }

  // ============================================================================
  // VENDOR CONTACTS CRUD
  // ============================================================================

  async findContacts(vendorId: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching contacts for vendor: ${vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(vendorId, userId, accessToken);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching contacts: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to fetch contacts: ${error.message}`);
    }

    return data || [];
  }

  async createContact(createContactDto: CreateVendorContactDto, userId: string, accessToken: string) {
    this.logger.log(`Creating contact for vendor: ${createContactDto.vendorId} (shared database)`, 'VendorsService');

    // Verify vendor exists (shared database - no user check)
    await this.findOne(createContactDto.vendorId, userId, accessToken);

    const contactData = this.convertToSnakeCase(createContactDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .insert(contactData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating contact: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to create contact: ${error.message}`);
    }

    return data;
  }

  async updateContact(id: string, updateContactDto: UpdateVendorContactDto, userId: string, accessToken: string) {
    this.logger.log(`Updating contact: ${id} (shared database)`, 'VendorsService');

    // Verify contact exists (shared database - no user check)
    const { data: contact, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .select('id, vendor_id')
      .eq('id', id)
      .single();

    if (getError || !contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    const contactData = this.convertToSnakeCase(updateContactDto);

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .update(contactData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating contact: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to update contact: ${error.message}`);
    }

    return data;
  }

  async removeContact(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting contact: ${id} (shared database)`, 'VendorsService');

    // Verify contact exists (shared database - no user check)
    const { data: contact, error: getError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .select('id')
      .eq('id', id)
      .single();

    if (getError || !contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_contacts')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting contact: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to delete contact: ${error.message}`);
    }

    return { message: 'Contact deleted successfully' };
  }

  // ============================================================================
  // FILTER OPTIONS
  // ============================================================================

  async getEquipmentTypes(userId: string, accessToken: string) {
    this.logger.log('Fetching all unique equipment types', 'VendorsService');

    // Get all vendor IDs for this user
    const { data: vendors, error: vendorsError } = await this.supabaseService
      .getClient(accessToken)
      .from('vendors')
      .select('id')
      .eq('user_id', userId);

    if (vendorsError || !vendors || vendors.length === 0) {
      return [];
    }

    const vendorIds = vendors.map(v => v.id);

    // Get distinct equipment types for user's vendors
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vendor_equipment')
      .select('equipment_type')
      .in('vendor_id', vendorIds)
      .not('equipment_type', 'is', null);

    if (error) {
      this.logger.error(`Error fetching equipment types: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to fetch equipment types: ${error.message}`);
    }

    // Extract unique equipment types
    const uniqueTypes = [...new Set(data?.map(e => e.equipment_type).filter(Boolean) || [])];
    return uniqueTypes.sort();
  }

  // ============================================================================
  // FILE IMPORT (CSV + XLSX)
  // ============================================================================

  // Column mapping for VENDOR_DATABASE_ENTERPRISE_ENRICHED.xlsx (0-indexed, 1 header row):
  // 0:S.No  1:Supplier Name  2:Full Address  3:Website  4:Company Phone
  // 5:Industries Served  6:Process  7:Materials  8:Countries Served  9:Annual Turnover
  // 10:Certifications  11:Inspection Options  12:QMS Metrics  13:QMS Procedures
  // 14:Workshop/Facility  15:Warehouse  16:Packing  17:Logistics
  // 18:Max Capacity  19:Avg Utilization  20:Shift Hours  21:Shifts/Day
  // 22:Working Days/Wk  23:In-House Testing  24:Operators  25:Engineers  26:Prod. Managers
  // 27:Contact 1  28:Title 1  29:Email 1  30:Phone 1
  // 31:Contact 2  32:Title 2  33:Email 2  34:Phone 2
  // 35:Company Profile  36:Machine List  37:LinkedIn URL (ignored)

  async importFromCsv(file: Express.Multer.File, userId: string, accessToken: string) {
    this.logger.log('Importing vendors from file (Shared Database Mode)', 'VendorsService');

    if (!file) {
      throw new InternalServerErrorException('No file provided');
    }

    try {
      let rows: string[][];
      const fileName = (file.originalname || '').toLowerCase();
      const isExcel =
        fileName.endsWith('.xlsx') ||
        fileName.endsWith('.xls') ||
        (file.mimetype || '').includes('spreadsheet') ||
        (file.mimetype || '').includes('excel');

      if (isExcel) {
        rows = await this.parseExcelBuffer(file.buffer);
      } else {
        rows = this.parseCsvRows(file.buffer.toString('utf-8'));
      }

      // Skip header row (row index 0 contains column names)
      // col[0] = S.No (serial number, skip), col[1] = Supplier Name
      const dataRows = rows.slice(1).filter(row => row[1]?.trim());

      const results = {
        total: dataRows.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [] as any[],
      };

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        try {
          const name = row[1]?.trim();
          if (!name) continue;

          // Dedup check by name (case-insensitive)
          const { data: existingVendor, error: checkError } = await this.supabaseService
            .getClient(accessToken)
            .from('vendors')
            .select('id, name')
            .ilike('name', name)
            .maybeSingle();

          if (checkError && checkError.code !== 'PGRST116') {
            results.failed++;
            results.errors.push({ row: i + 2, name, error: `Database error: ${checkError.message}` });
            continue;
          }

          if (existingVendor) {
            results.skipped++;
            continue;
          }

          const codeBase = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
          const supplierCode = `VND-${codeBase}-${Date.now().toString(36).slice(-4).toUpperCase()}`;

          const address = row[2]?.trim() || null;

          const vendorPayload = {
            supplier_code: supplierCode,
            name,
            addresses: address,
            website: row[3]?.trim() || null,
            company_phone: row[4]?.trim() || null,
            industries: this.parseArrayField(row[5]),
            process: this.parseArrayField(row[6]),
            materials: this.parseArrayField(row[7]),
            countries_served: row[8]?.trim() || null,
            company_turnover: row[9]?.trim() || null,
            certifications: this.parseArrayField(row[10]),
            inspection_options: row[11]?.trim() || null,
            qms_metrics: row[12]?.trim() || null,
            qms_procedures: row[13]?.trim() || null,
            manufacturing_workshop: row[14]?.trim() || null,
            warehouse: this.parseBoolean(row[15]),
            packing: this.parseBoolean(row[16]),
            logistics_transportation: this.parseBoolean(row[17]),
            maximum_production_capacity: row[18]?.trim() || null,
            average_capacity_utilization: this.parseNumber(row[19]),
            num_hours_in_shift: this.parseInteger(row[20]),
            num_shifts_in_day: this.parseInteger(row[21]),
            num_working_days_per_week: this.parseInteger(row[22]),
            in_house_material_testing: this.parseBoolean(row[23]),
            num_operators: this.parseInteger(row[24]),
            num_engineers: this.parseInteger(row[25]),
            num_production_managers: this.parseInteger(row[26]),
            company_profile_url: row[35]?.trim() || null,
            machine_list_url: row[36]?.trim() || null,
            city: this.extractCity(address || ''),
            state: this.extractState(address || ''),
            country: this.extractCountry(address || ''),
            user_id: userId,
            status: 'active',
            vendor_type: 'supplier',
          };

          const { data: vendor, error: vendorError } = await this.supabaseService
            .getClient(accessToken)
            .from('vendors')
            .insert(vendorPayload)
            .select()
            .single();

          if (vendorError) {
            results.failed++;
            let errorMsg = vendorError.message;
            if (vendorError.message.includes('duplicate key')) errorMsg = `Vendor "${name}" already exists.`;
            else if (vendorError.message.includes('violates row-level security')) errorMsg = `Access denied for "${name}".`;
            results.errors.push({ row: i + 2, name, error: errorMsg });
            continue;
          }

          // Contact 1
          const c1Name = row[27]?.trim();
          if (c1Name && vendor?.id) {
            await this.supabaseService.getClient(accessToken).from('vendor_contacts').insert({
              vendor_id: vendor.id,
              name: c1Name,
              designation: row[28]?.trim() || null,
              email: row[29]?.trim() || null,
              phone: row[30]?.trim() || null,
              is_primary: true,
            });
          }

          // Contact 2
          const c2Name = row[31]?.trim();
          if (c2Name && vendor?.id) {
            await this.supabaseService.getClient(accessToken).from('vendor_contacts').insert({
              vendor_id: vendor.id,
              name: c2Name,
              designation: row[32]?.trim() || null,
              email: row[33]?.trim() || null,
              phone: row[34]?.trim() || null,
              is_primary: false,
            });
          }

          results.created++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({ row: i + 2, name: dataRows[i]?.[1] || 'Unknown', error: error.message });
        }
      }

      this.logger.log(
        `File import completed: ${results.created} created, ${results.skipped} skipped, ${results.failed} failed`,
        'VendorsService',
      );

      return {
        message: `Import completed: ${results.created} created, ${results.skipped} skipped (duplicates), ${results.failed} failed.`,
        ...results,
      };
    } catch (error: any) {
      this.logger.error(`File import failed: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to import file: ${error.message}`);
    }
  }

  private async parseExcelBuffer(buffer: Buffer): Promise<string[][]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row: any) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any) => {
        const val = cell.value;
        if (val === null || val === undefined) {
          values.push('');
        } else if (typeof val === 'object') {
          if (val.text !== undefined) values.push(String(val.text).trim());
          else if (val.result !== undefined) values.push(String(val.result).trim());
          else if (val.hyperlink !== undefined) values.push(String(val.hyperlink).trim());
          else values.push(String(val).trim());
        } else {
          values.push(String(val).trim());
        }
      });
      rows.push(values);
    });

    return rows;
  }

  private parseCsvRows(csvContent: string): string[][] {
    return csvContent
      .split('\n')
      .filter(line => line.trim())
      .map(line => this.parseCSVLine(line));
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  private parseBoolean(value: string): boolean {
    if (!value || value === 'NA') return false;
    const lower = value.toLowerCase().trim();
    return lower === 'yes' || lower === 'true' || lower === '1';
  }

  private parseNumber(value: string): number | null {
    if (!value || value === 'NA') return null;
    // Remove percentage signs, commas, and whitespace
    const cleaned = value.toString().trim().replace(/[%,]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  private parseInteger(value: string): number | null {
    if (!value || value === 'NA') return null;
    // Remove percentage signs, commas, and whitespace
    const cleaned = value.toString().trim().replace(/[%,]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    // Round to nearest integer to handle decimal inputs like "8.5" or "30.4"
    return Math.round(num);
  }

  private parsePercentage(value: string): number | null {
    if (!value || value === 'NA') return null;
    // Remove percentage sign, whitespace, and convert to number
    const cleaned = value.toString().trim().replace('%', '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;

    // If original value had %, assume it's already in 0-100 range
    // Otherwise assume it needs no conversion
    return num;
  }

  private parseArrayField(value: string): string[] {
    if (!value || value.trim() === '' || value.trim() === 'NA') {
      return [];
    }
    return value
      .split(',')
      .map(s => s.trim())
      .filter(s => s && s !== 'NA' && s !== '');
  }

  private extractCity(address: string): string | null {
    if (!address) return null;
    // Extract city from address (typically before state/country)
    const parts = address.split(',');
    if (parts.length >= 3) {
      return parts[parts.length - 3].trim();
    }
    return null;
  }

  private extractState(address: string): string | null {
    if (!address) return null;
    // Extract state from address
    const parts = address.split(',');
    if (parts.length >= 2) {
      const stateAndZip = parts[parts.length - 2].trim();
      // Remove zip code if present
      return stateAndZip.replace(/\d+/g, '').trim();
    }
    return null;
  }

  private extractCountry(address: string): string {
    if (!address) return 'India';
    // Extract country from address (typically last part)
    const parts = address.split(',');
    if (parts.length > 0) {
      const country = parts[parts.length - 1].trim();
      if (country.toLowerCase().includes('india')) return 'India';
      if (country.toLowerCase().includes('china')) return 'China';
      if (country.toLowerCase().includes('usa')) return 'USA';
      return country;
    }
    return 'India';
  }

  private convertToSnakeCase(obj: any): any {
    const snakeObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      snakeObj[snakeKey] = value;
    }
    return snakeObj;
  }

  private convertToCamelCase(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(item => this.convertToCamelCase(item));

    const camelObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      camelObj[camelKey] = value;
    }
    return camelObj;
  }
}
