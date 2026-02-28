import { 
  Controller, 
  Get, 
  Post, 
  Put, 
  Body, 
  Param, 
  Query, 
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
  ApiBody 
} from '@nestjs/swagger';
import { InvoiceService } from '../services/invoice.service';
import { CreateDeliveryInvoiceDto, InvoiceStatus } from '../dto/delivery.dto';

@ApiTags('Delivery - Invoices')
@Controller({ path: 'api/delivery/invoices', version: '1' })
export class InvoiceController {
  private readonly logger = new Logger(InvoiceController.name);

  constructor(private readonly invoiceService: InvoiceService) {}

  @Post('from-delivery/:deliveryOrderId')
  @ApiOperation({ 
    summary: 'Create invoice from delivery order',
    description: 'Creates an invoice from a delivered order with automatic line item generation'
  })
  @ApiParam({ name: 'deliveryOrderId', description: 'Delivery order UUID' })
  @ApiBody({ type: CreateDeliveryInvoiceDto })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Invoice created successfully'
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid delivery order or already invoiced' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Delivery order not found' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async createInvoiceFromDeliveryOrder(
    @Param('deliveryOrderId', ParseUUIDPipe) deliveryOrderId: string,
    @Body() createInvoiceDto: CreateDeliveryInvoiceDto
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system';
      
      const invoice = await this.invoiceService.createInvoiceFromDeliveryOrder(
        deliveryOrderId,
        createInvoiceDto,
        userId
      );

      return {
        success: true,
        data: invoice,
        message: 'Invoice created successfully from delivery order',
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          deliveryOrderNumber: invoice.deliveryOrderNumber,
          totalAmount: invoice.totalAmountInr,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to create invoice from delivery order ${deliveryOrderId}: ${error.message}`);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get invoices with filtering and pagination',
    description: 'Retrieves invoices with optional filtering by project, status, and date range'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter by project ID' })
  @ApiQuery({ name: 'status', required: false, enum: InvoiceStatus, description: 'Filter by invoice status' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date for filtering (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date for filtering (ISO format)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoices retrieved successfully'
  })
  async getInvoices(
    @Query('projectId') projectId?: string,
    @Query('status') status?: InvoiceStatus,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20
  ) {
    try {
      // Validate and convert dates
      const startDateObj = startDate ? new Date(startDate) : undefined;
      const endDateObj = endDate ? new Date(endDate) : undefined;

      // Validate pagination parameters
      const pageNum = Math.max(1, page);
      const limitNum = Math.min(100, Math.max(1, limit));

      const result = await this.invoiceService.getInvoices(
        projectId,
        status,
        startDateObj,
        endDateObj,
        pageNum,
        limitNum
      );

      return {
        success: true,
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit),
          hasNext: result.page < Math.ceil(result.total / result.limit),
          hasPrev: result.page > 1
        },
        metadata: {
          filters: {
            projectId,
            status,
            startDate: startDateObj?.toISOString(),
            endDate: endDateObj?.toISOString()
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get invoices: ${error.message}`);
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ 
    summary: 'Get invoice by ID',
    description: 'Retrieves a specific invoice with full details including line items'
  })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoice retrieved successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  async getInvoiceById(@Param('id', ParseUUIDPipe) id: string) {
    try {
      const invoice = await this.invoiceService.getInvoiceById(id);

      return {
        success: true,
        data: invoice,
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get invoice ${id}: ${error.message}`);
      throw error;
    }
  }

  @Put(':id/status')
  @ApiOperation({ 
    summary: 'Update invoice status',
    description: 'Updates the status of an invoice (draft → sent → paid, etc.)'
  })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { 
          type: 'string', 
          enum: Object.values(InvoiceStatus),
          description: 'New invoice status'
        },
        paymentAmount: {
          type: 'number',
          description: 'Payment amount (required for paid status)',
          minimum: 0
        },
        paymentDate: {
          type: 'string',
          format: 'date',
          description: 'Payment date (required for paid status)'
        },
        paymentReference: {
          type: 'string',
          description: 'Payment reference number (required for paid status)'
        },
        paymentMethod: {
          type: 'string',
          description: 'Payment method (bank transfer, cash, etc.)'
        }
      }
    }
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoice status updated successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid status transition or missing payment data' })
  async updateInvoiceStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      status: InvoiceStatus;
      paymentAmount?: number;
      paymentDate?: string;
      paymentReference?: string;
      paymentMethod?: string;
    }
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system';

      const metadata = body.status === InvoiceStatus.PAID ? {
        paymentAmount: body.paymentAmount,
        paymentDate: body.paymentDate,
        paymentReference: body.paymentReference,
        paymentMethod: body.paymentMethod
      } : undefined;

      const invoice = await this.invoiceService.updateInvoiceStatus(
        id,
        body.status,
        userId,
        metadata
      );

      return {
        success: true,
        data: invoice,
        message: `Invoice status updated to ${body.status}`,
        metadata: {
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to update invoice status for ${id}: ${error.message}`);
      throw error;
    }
  }

  @Post(':id/payment')
  @ApiOperation({ 
    summary: 'Record payment against invoice',
    description: 'Records a payment against an invoice, supporting partial payments'
  })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['paymentAmount', 'paymentDate', 'paymentReference'],
      properties: {
        paymentAmount: {
          type: 'number',
          description: 'Payment amount',
          minimum: 0.01
        },
        paymentDate: {
          type: 'string',
          format: 'date',
          description: 'Date when payment was received'
        },
        paymentReference: {
          type: 'string',
          description: 'Payment reference number or transaction ID'
        },
        paymentMethod: {
          type: 'string',
          description: 'Payment method (bank transfer, cash, cheque, etc.)',
          default: 'bank_transfer'
        }
      }
    }
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Payment recorded successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Payment amount exceeds outstanding balance' })
  async recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      paymentAmount: number;
      paymentDate: string;
      paymentReference: string;
      paymentMethod?: string;
    }
  ) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system';

      const invoice = await this.invoiceService.recordPayment(
        id,
        body.paymentAmount,
        new Date(body.paymentDate),
        body.paymentReference,
        body.paymentMethod || 'bank_transfer',
        userId
      );

      return {
        success: true,
        data: invoice,
        message: `Payment of ₹${body.paymentAmount} recorded successfully`,
        metadata: {
          paymentReference: body.paymentReference,
          newPaidAmount: invoice.paidAmountInr,
          remainingBalance: invoice.totalAmountInr - invoice.paidAmountInr,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to record payment for invoice ${id}: ${error.message}`);
      throw error;
    }
  }

  @Get('metrics/summary')
  @ApiOperation({ 
    summary: 'Get invoice analytics and metrics',
    description: 'Retrieves comprehensive invoice metrics including collection rates, outstanding amounts, etc.'
  })
  @ApiQuery({ name: 'projectId', required: false, description: 'Filter metrics by project ID' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date for metrics (ISO format)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date for metrics (ISO format)' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoice metrics retrieved successfully'
  })
  async getInvoiceMetrics(
    @Query('projectId') projectId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ) {
    try {
      const startDateObj = startDate ? new Date(startDate) : undefined;
      const endDateObj = endDate ? new Date(endDate) : undefined;

      const metrics = await this.invoiceService.getInvoiceMetrics(
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
      this.logger.error(`Failed to get invoice metrics: ${error.message}`);
      throw error;
    }
  }

  @Get(':id/pdf')
  @ApiOperation({ 
    summary: 'Generate invoice PDF',
    description: 'Generates and returns a PDF version of the invoice'
  })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoice PDF generated successfully',
    content: {
      'application/pdf': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  @ApiResponse({ status: HttpStatus.NOT_IMPLEMENTED, description: 'PDF generation not implemented yet' })
  async generateInvoicePDF(@Param('id', ParseUUIDPipe) id: string) {
    try {
      // First verify invoice exists
      await this.invoiceService.getInvoiceById(id);

      // TODO: Implement PDF generation
      return {
        success: false,
        message: 'PDF generation feature is not yet implemented',
        metadata: {
          invoiceId: id,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to generate PDF for invoice ${id}: ${error.message}`);
      throw error;
    }
  }

  @Put(':id/send')
  @ApiOperation({ 
    summary: 'Mark invoice as sent',
    description: 'Updates invoice status to sent and records the sent timestamp'
  })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Invoice marked as sent successfully'
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Invoice not found' })
  async markInvoiceAsSent(@Param('id', ParseUUIDPipe) id: string) {
    try {
      // For now, using a default user ID - replace with actual user from token
      const userId = 'system';

      const invoice = await this.invoiceService.updateInvoiceStatus(
        id,
        InvoiceStatus.SENT,
        userId
      );

      return {
        success: true,
        data: invoice,
        message: 'Invoice marked as sent successfully',
        metadata: {
          sentAt: invoice.sentAt,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to mark invoice ${id} as sent: ${error.message}`);
      throw error;
    }
  }

  @Get('projects/:projectId/summary')
  @ApiOperation({ 
    summary: 'Get project invoice summary',
    description: 'Retrieves invoice summary for a specific project'
  })
  @ApiParam({ name: 'projectId', description: 'Project UUID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Project invoice summary retrieved successfully'
  })
  async getProjectInvoiceSummary(@Param('projectId', ParseUUIDPipe) projectId: string) {
    try {
      const metrics = await this.invoiceService.getInvoiceMetrics(projectId);

      // Get recent invoices for the project
      const recentInvoices = await this.invoiceService.getInvoices(
        projectId,
        undefined,
        undefined,
        undefined,
        1,
        5
      );

      return {
        success: true,
        data: {
          summary: metrics,
          recentInvoices: recentInvoices.data
        },
        metadata: {
          projectId,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get project invoice summary for ${projectId}: ${error.message}`);
      throw error;
    }
  }
}