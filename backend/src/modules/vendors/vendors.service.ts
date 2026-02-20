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
  // CSV IMPORT
  // ============================================================================

  async importFromCsv(file: Express.Multer.File, userId: string, accessToken: string) {
    this.logger.log('Importing vendors from CSV (Shared Database Mode)', 'VendorsService');

    if (!file) {
      throw new InternalServerErrorException('No file provided');
    }

    try {
      const csvContent = file.buffer.toString('utf-8');
      const lines = csvContent.split('\n');

      // Skip header rows (first 2 rows)
      const dataLines = lines.slice(2).filter(line => line.trim());

      const results = {
        total: dataLines.length,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        errors: [] as any[],
      };

      for (let i = 0; i < dataLines.length; i++) {
        let row: string[] = [];
        try {
          row = this.parseCSVLine(dataLines[i]);
          if (row.length < 10) continue; // Skip invalid rows

          const vendorData = this.mapCSVToVendor(row, i + 3); // +3 for header rows and 1-based index

          // Create vendor - handle duplicates in shared database
          const supplierCode = `CUS-${row[0]}`;

          // Check if vendor already exists in shared database (any user)
          const { data: existingVendor, error: checkError } = await this.supabaseService
            .getClient(accessToken)
            .from('vendors')
            .select('id, user_id, supplier_code, name, updated_at')
            .eq('supplier_code', supplierCode)
            .maybeSingle();

          // If there's an error checking, log and skip this row
          if (checkError && checkError.code !== 'PGRST116') {
            this.logger.warn(`Error checking for existing vendor: ${checkError.message}`, 'VendorsService');
            results.failed++;
            results.errors.push({
              row: i + 3,
              name: row[1],
              error: `Database error: ${checkError.message}`,
            });
            continue;
          }

          const isUpdate = !!existingVendor;

          // Skip if vendor exists and data is identical (optimization)
          if (existingVendor && existingVendor.name === row[1]) {
            // Quick check - if name matches, likely a duplicate upload
            results.skipped++;
            continue;
          }

          const vendorPayload = {
            supplier_code: supplierCode,
            name: row[1],
            addresses: row[2],
            website: row[3],
            company_phone: row[4],
            major_customers: row[5] !== 'NA' ? row[5] : null,
            countries_served: row[6] !== 'NA' ? row[6] : null,
            company_turnover: row[7] !== 'NA' ? row[7] : null,
            industries: this.parseArrayField(row[8]),
            process: this.parseArrayField(row[9]),
            materials: this.parseArrayField(row[10]),
            certifications: this.parseArrayField(row[11]),
            inspection_options: row[12] !== 'NA' ? row[12] : null,
            qms_metrics: row[13] !== 'NA' ? row[13] : null,
            qms_procedures: row[14] !== 'NA' ? row[14] : null,
            manufacturing_workshop: row[15] !== 'NA' ? row[15] : null,
            warehouse: this.parseBoolean(row[16]),
            packing: this.parseBoolean(row[17]),
            logistics_transportation: this.parseBoolean(row[18]),
            maximum_production_capacity: row[19] !== 'NA' ? row[19] : null,
            average_capacity_utilization: this.parseNumber(row[20]),
            num_hours_in_shift: this.parseInteger(row[21]),
            num_shifts_in_day: this.parseInteger(row[22]),
            num_working_days_per_week: this.parseInteger(row[23]),
            in_house_material_testing: this.parseBoolean(row[24]),
            num_operators: this.parseInteger(row[25]),
            num_engineers: this.parseInteger(row[26]),
            num_production_managers: this.parseInteger(row[27]),
            company_profile_url: row[36],
            machine_list_url: row[37],
            city: this.extractCity(row[2]),
            state: this.extractState(row[2]),
            country: this.extractCountry(row[2]),
            user_id: userId,
            status: 'active',
            vendor_type: 'supplier',
          };

          // Use conditional INSERT/UPDATE for shared database
          let vendor: any;
          let vendorError: any;

          if (isUpdate) {
            // Update existing vendor in shared database
            // Exclude immutable fields (supplier_code shouldn't change)
            const { supplier_code, ...updatePayload } = vendorPayload;
            const { data, error } = await this.supabaseService
              .getClient(accessToken)
              .from('vendors')
              .update(updatePayload)
              .eq('id', existingVendor.id)
              .select()
              .single();
            vendor = data;
            vendorError = error;
          } else {
            // Insert new vendor to shared database
            const { data, error } = await this.supabaseService
              .getClient(accessToken)
              .from('vendors')
              .insert(vendorPayload)
              .select()
              .single();
            vendor = data;
            vendorError = error;
          }

          if (vendorError) {
            results.failed++;
            // Provide better error message for duplicate key constraint
            let errorMessage = vendorError.message;
            if (vendorError.message.includes('duplicate key') && vendorError.message.includes('vendors_supplier_code_key')) {
              errorMessage = `Supplier code ${supplierCode} already exists in the system. The vendor cannot be updated (may belong to different user or access restricted).`;
            } else if (vendorError.message.includes('violates row-level security policy')) {
              errorMessage = `Access denied: Cannot ${isUpdate ? 'update' : 'create'} vendor due to security policy`;
            }
            results.errors.push({
              row: i + 3,
              name: row[1],
              error: errorMessage,
            });
            continue;
          }

          // Create or update contacts if available
          if (row[28] && row[30] && vendor?.id) {
            // Delete existing primary contact if updating
            if (isUpdate) {
              await this.supabaseService
                .getClient(accessToken)
                .from('vendor_contacts')
                .delete()
                .eq('vendor_id', vendor.id)
                .eq('is_primary', true);
            }

            await this.supabaseService
              .getClient(accessToken)
              .from('vendor_contacts')
              .insert({
                vendor_id: vendor.id,
                name: row[28],
                designation: row[29],
                email: row[30],
                phone: row[31],
                is_primary: true,
              });
          }

          if (row[32] && row[34] && vendor?.id) {
            // Delete existing secondary contact if updating
            if (isUpdate) {
              await this.supabaseService
                .getClient(accessToken)
                .from('vendor_contacts')
                .delete()
                .eq('vendor_id', vendor.id)
                .eq('is_primary', false);
            }

            await this.supabaseService
              .getClient(accessToken)
              .from('vendor_contacts')
              .insert({
                vendor_id: vendor.id,
                name: row[32],
                designation: row[33],
                email: row[34],
                phone: row[35],
                is_primary: false,
              });
          }

          if (isUpdate) {
            results.updated++;
          } else {
            results.created++;
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            row: i + 3,
            name: row[1] || 'Unknown',
            error: error.message,
          });
        }
      }

      this.logger.log(
        `CSV Import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped, ${results.failed} failed`,
        'VendorsService'
      );

      return {
        message: `Import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped (duplicates), ${results.failed} failed.`,
        ...results,
      };
    } catch (error: any) {
      this.logger.error(`CSV import failed: ${error.message}`, 'VendorsService');
      throw new InternalServerErrorException(`Failed to import CSV: ${error.message}`);
    }
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

  private mapCSVToVendor(row: string[], rowNumber: number): any {
    // This method can be used for additional mapping if needed
    return row;
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
