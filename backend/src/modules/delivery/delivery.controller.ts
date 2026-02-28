import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Body, 
  Param, 
  Query, 
  UseGuards,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
  ValidationPipe,
  UsePipes
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiParam, 
  ApiQuery,
  ApiBearerAuth,
  ApiBody 
} from '@nestjs/swagger';
import { DeliveryService } from './delivery.service';
import { 
  CreateDeliveryOrderDto, 
  UpdateDeliveryOrderDto, 
  DeliveryOrderQueryDto,
  DeliveryOrderResponseDto,
  CreateDeliveryAddressDto,
  CreateTrackingEventDto
} from './dto/delivery.dto';
// import { AuthGuard } from '@nestjs/passport';
// import { CurrentUser } from '@/common/decorators/current-user.decorator';

@ApiTags('Delivery')
@Controller({ path: 'api/delivery', version: '1' })
// @UseGuards(AuthGuard('jwt'))
// @ApiBearerAuth()
export class DeliveryController {
  private readonly logger = new Logger(DeliveryController.name);

  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('available-items/:projectId')
  @ApiOperation({ 
    summary: 'Get quality-approved items available for delivery',
    description: 'Retrieves all QC-approved BOM items that are ready for delivery for a specific project'
  })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Available items retrieved successfully',
    // type: [QualityApprovedItemDto]
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid project ID' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Authentication required' })
  async getAvailableItemsForDelivery(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    // @CurrentUser() user: any
  ) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user'; // user?.id || user?.sub || 'system';
      
      const availableItems = await this.deliveryService.getAvailableItemsForDelivery(projectId, userId);
      
      return {
        success: true,
        data: availableItems,
        metadata: {
          count: availableItems.length,
          timestamp: new Date().toISOString(),
          projectId
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get available items for project ${projectId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post('orders')
  @ApiOperation({ 
    summary: 'Create a new delivery order',
    description: 'Creates a new delivery order from QC-approved items with comprehensive validation'
  })
  @ApiBody({ type: CreateDeliveryOrderDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Delivery order created successfully',
    type: DeliveryOrderResponseDto
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data or validation failed' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, address, or items not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Authentication required' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Insufficient permissions for project' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async createDeliveryOrder(
    @Body() createDeliveryOrderDto: CreateDeliveryOrderDto,
    // @CurrentUser() user: any
  ) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user'; // user?.id || user?.sub || 'system';
      
      this.logger.log(`Creating delivery order for project ${createDeliveryOrderDto.projectId} by user ${userId}`);
      
      const deliveryOrder = await this.deliveryService.createDeliveryOrder(
        createDeliveryOrderDto,
        userId
      );

      return {
        success: true,
        data: deliveryOrder,
        message: `Delivery order ${deliveryOrder.orderNumber} created successfully`,
        metadata: {
          orderNumber: deliveryOrder.orderNumber,
          projectId: deliveryOrder.projectId,
          status: deliveryOrder.status,
          itemCount: deliveryOrder.items?.length || 0,
          totalCost: deliveryOrder.totalDeliveryCostInr,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to create delivery order for project ${createDeliveryOrderDto.projectId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('orders')
  @ApiOperation({ 
    summary: 'Get delivery orders with filtering and pagination',
    description: 'Retrieves delivery orders with optional filtering, search, and pagination'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by delivery status (can be array)' })
  @ApiQuery({ name: 'priority', required: false, description: 'Filter by delivery priority (can be array)' })
  @ApiQuery({ name: 'carrierId', required: false, description: 'Filter by carrier ID' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in order number, tracking number, company name' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date filter (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date filter (ISO format)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort field (default: createdAt)' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order: asc|desc (default: desc)' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery orders retrieved successfully'
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Authentication required' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDeliveryOrders(
    @Query() queryDto: DeliveryOrderQueryDto,
    // @CurrentUser() user: any
  ) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user'; // user?.id || user?.sub || 'system';
      
      this.logger.debug(`Fetching delivery orders with filters: ${JSON.stringify(queryDto)} for user ${userId}`);
      
      const result = await this.deliveryService.getDeliveryOrders(queryDto, userId);

      return {
        success: true,
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
          hasNext: result.page < Math.ceil(result.total / result.limit),
          hasPrev: result.page > 1,
          showing: {
            from: ((result.page - 1) * result.limit) + 1,
            to: Math.min(result.page * result.limit, result.total)
          }
        },
        metadata: {
          timestamp: new Date().toISOString(),
          filters: queryDto,
          appliedFilters: Object.keys(queryDto).filter(key => 
            (queryDto as any)[key] !== undefined && (queryDto as any)[key] !== null && (queryDto as any)[key] !== ''
          )
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery orders: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('orders/:id')
  @ApiOperation({ 
    summary: 'Get delivery order by ID',
    description: 'Retrieves a specific delivery order with full details including items and tracking'
  })
  @ApiParam({ name: 'id', description: 'Delivery order UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery order retrieved successfully',
    type: DeliveryOrderResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Delivery order not found' })
  async getDeliveryOrderById(@Param('id', ParseUUIDPipe) id: string) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user';
      const deliveryOrder = await this.deliveryService.getDeliveryOrderById(id, userId);

      return {
        success: true,
        data: deliveryOrder,
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery order ${id}: ${error.message}`);
      throw error;
    }
  }

  @Put('orders/:id')
  @ApiOperation({ 
    summary: 'Update delivery order',
    description: 'Updates an existing delivery order (status, carrier, costs, etc.)'
  })
  @ApiParam({ name: 'id', description: 'Delivery order UUID' })
  @ApiBody({ type: UpdateDeliveryOrderDto })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery order updated successfully',
    type: DeliveryOrderResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Delivery order not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Cannot update delivered or cancelled orders' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateDeliveryOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDeliveryOrderDto: UpdateDeliveryOrderDto,
    // @CurrentUser() user: any
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system'; // user?.id || 'system';
      
      const deliveryOrder = await this.deliveryService.updateDeliveryOrder(
        id,
        updateDeliveryOrderDto,
        userId
      );

      return {
        success: true,
        data: deliveryOrder,
        message: 'Delivery order updated successfully',
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to update delivery order ${id}: ${error.message}`);
      throw error;
    }
  }

  @Post('tracking')
  @ApiOperation({ 
    summary: 'Add tracking event',
    description: 'Adds a new tracking event for a delivery order'
  })
  @ApiBody({ type: CreateTrackingEventDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Tracking event added successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Delivery order not found' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async addTrackingEvent(
    @Body() createTrackingEventDto: CreateTrackingEventDto,
    // @CurrentUser() user: any
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system'; // user?.id || 'system';
      
      await this.deliveryService.addTrackingEvent(createTrackingEventDto, userId);

      return {
        success: true,
        message: 'Tracking event added successfully',
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to add tracking event: ${error.message}`);
      throw error;
    }
  }

  @Get('metrics')
  @ApiOperation({ 
    summary: 'Get delivery performance metrics',
    description: 'Retrieves delivery performance metrics with optional filtering by project and date range'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date for metrics (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date for metrics (ISO format)' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery metrics retrieved successfully'
  })
  async getDeliveryMetrics(
    @Query('projectId') projectId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      const startDateObj = startDate ? new Date(startDate) : undefined;
      const endDateObj = endDate ? new Date(endDate) : undefined;

      const metrics = await this.deliveryService.getDeliveryMetrics(
        projectId,
        startDateObj,
        endDateObj
      );

      return {
        success: true,
        data: metrics,
        metadata: {
          filters: {
            projectId,
            startDate: startDateObj?.toISOString(),
            endDate: endDateObj?.toISOString()
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery metrics: ${error.message}`);
      throw error;
    }
  }

  @Post('addresses')
  @ApiOperation({ 
    summary: 'Create delivery address',
    description: 'Creates a new delivery address for a project'
  })
  @ApiBody({ type: CreateDeliveryAddressDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Delivery address created successfully'
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async createDeliveryAddress(
    @Body() createAddressDto: CreateDeliveryAddressDto,
    // @CurrentUser() user: any
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system'; // user?.id || 'system';
      
      const address = await this.deliveryService.createDeliveryAddress(createAddressDto, userId);

      return {
        success: true,
        data: address,
        message: 'Delivery address created successfully',
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to create delivery address: ${error.message}`);
      throw error;
    }
  }

  @Get('addresses/:projectId')
  @ApiOperation({ 
    summary: 'Get delivery addresses for project',
    description: 'Retrieves all delivery addresses for a specific project'
  })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery addresses retrieved successfully'
  })
  async getDeliveryAddresses(@Param('projectId', ParseUUIDPipe) projectId: string) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user';
      const addresses = await this.deliveryService.getDeliveryAddresses(projectId, userId);

      return {
        success: true,
        data: addresses,
        metadata: {
          count: addresses.length,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery addresses for project ${projectId}: ${error.message}`);
      throw error;
    }
  }

  @Get('carriers')
  @ApiOperation({ 
    summary: 'Get available carriers',
    description: 'Retrieves all active carriers available for delivery'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Carriers retrieved successfully'
  })
  async getCarriers() {
    try {
      const carriers = await this.deliveryService.getCarriers();

      return {
        success: true,
        data: carriers,
        metadata: {
          count: carriers.length,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get carriers: ${error.message}`);
      throw error;
    }
  }

  @Get('orders/:id/tracking')
  @ApiOperation({ 
    summary: 'Get tracking events for delivery order',
    description: 'Retrieves all tracking events for a specific delivery order'
  })
  @ApiParam({ name: 'id', description: 'Delivery order UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Tracking events retrieved successfully'
  })
  async getTrackingEvents(@Param('id', ParseUUIDPipe) id: string) {
    try {
      // For production, replace with actual user ID from auth token
      const userId = 'authenticated-user';
      // This will be part of the getDeliveryOrderById, but can be separate endpoint
      const deliveryOrder = await this.deliveryService.getDeliveryOrderById(id, userId);

      return {
        success: true,
        data: {
          orderId: id,
          orderNumber: deliveryOrder.orderNumber,
          status: deliveryOrder.status,
          trackingNumber: deliveryOrder.trackingNumber,
          events: (deliveryOrder as any).tracking || []
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get tracking events for order ${id}: ${error.message}`);
      throw error;
    }
  }

  @Post('orders/:id/cancel')
  @ApiOperation({ 
    summary: 'Cancel delivery order',
    description: 'Cancels a delivery order if it has not been shipped'
  })
  @ApiParam({ name: 'id', description: 'Delivery order UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery order cancelled successfully'
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Cannot cancel shipped orders' })
  async cancelDeliveryOrder(
    @Param('id', ParseUUIDPipe) id: string,
    // @CurrentUser() user: any
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system'; // user?.id || 'system';
      
      const cancelledOrder = await this.deliveryService.updateDeliveryOrder(
        id,
        { status: 'cancelled' as any },
        userId
      );

      return {
        success: true,
        data: cancelledOrder,
        message: 'Delivery order cancelled successfully',
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to cancel delivery order ${id}: ${error.message}`);
      throw error;
    }
  }

  @Get('batches')
  @ApiOperation({ 
    summary: 'Get delivery batches',
    description: 'Retrieves delivery batches for a project'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery batches retrieved successfully'
  })
  async getDeliveryBatches(
    @Query('projectId') projectId?: string
  ) {
    try {
      // For now, return mock data - implement actual batching logic later
      const mockBatches = [
        {
          id: 'batch-001',
          batchNumber: 'BTH-2026-001',
          status: 'ready_for_shipment',
          itemCount: 15,
          totalValue: 25000,
          expectedCompletion: new Date().toISOString(),
          notes: 'Ready for delivery'
        }
      ];

      return {
        success: true,
        data: mockBatches,
        metadata: {
          count: mockBatches.length,
          timestamp: new Date().toISOString(),
          projectId
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery batches: ${error.message}`);
      throw error;
    }
  }

  @Get('shipments')
  @ApiOperation({ 
    summary: 'Get delivery shipments',
    description: 'Retrieves delivery shipments for a project'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Delivery shipments retrieved successfully'
  })
  async getDeliveryShipments(
    @Query('projectId') projectId?: string
  ) {
    try {
      // For now, return mock data - implement actual shipment logic later
      const mockShipments = [
        {
          id: 'shipment-001',
          shipmentNumber: 'SHP-2026-001',
          status: 'in_transit',
          origin: 'Warehouse A',
          destination: 'Customer Site',
          carrierName: 'FedEx India',
          trackingNumber: 'FDX123456789',
          departureDate: new Date().toISOString(),
          estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        }
      ];

      return {
        success: true,
        data: mockShipments,
        metadata: {
          count: mockShipments.length,
          timestamp: new Date().toISOString(),
          projectId
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get delivery shipments: ${error.message}`);
      throw error;
    }
  }
}