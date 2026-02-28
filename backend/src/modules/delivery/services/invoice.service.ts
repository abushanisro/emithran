import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectKnex, Knex } from 'nestjs-knex';
import { CreateDeliveryInvoiceDto, InvoiceStatus } from '../dto/delivery.dto';

export interface InvoiceLineItem {
  deliveryItemId: string;
  itemDescription: string;
  partNumber: string;
  quantity: number;
  unitPriceInr: number;
  lineTotalInr: number;
  taxRate: number;
  taxAmountInr: number;
}

export interface CreateInvoiceRequest {
  deliveryOrderId: string;
  invoiceDetails: CreateDeliveryInvoiceDto;
  lineItems: InvoiceLineItem[];
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    @InjectKnex() private readonly knex: Knex
  ) {}

  /**
   * Create invoice from delivery order
   */
  async createInvoiceFromDeliveryOrder(
    deliveryOrderId: string,
    invoiceData: CreateDeliveryInvoiceDto,
    userId: string
  ): Promise<any> {
    const trx = await this.knex.transaction();

    try {
      // Validate delivery order exists and is delivered
      const deliveryOrder = await trx('delivery_orders as do')
        .select([
          'do.*',
          'p.name as project_name',
          'da.company_name',
          'da.address_line1',
          'da.address_line2', 
          'da.city',
          'da.state_province',
          'da.postal_code',
          'da.country'
        ])
        .join('projects as p', 'do.project_id', 'p.id')
        .join('delivery_addresses as da', 'do.delivery_address_id', 'da.id')
        .where('do.id', deliveryOrderId)
        .first();

      if (!deliveryOrder) {
        throw new NotFoundException('Delivery order not found');
      }

      if (deliveryOrder.status !== 'delivered') {
        throw new BadRequestException('Can only create invoice for delivered orders');
      }

      // Check if invoice already exists for this delivery order
      const existingInvoice = await trx('delivery_invoices')
        .where('delivery_order_id', deliveryOrderId)
        .first();

      if (existingInvoice) {
        throw new BadRequestException('Invoice already exists for this delivery order');
      }

      // Get delivery items with BOM details for invoice line items
      const deliveryItems = await trx('delivery_items as di')
        .select([
          'di.*',
          'bi.part_number',
          'bi.description as bom_description',
          'bi.unit_cost_inr'
        ])
        .join('bom_items as bi', 'di.bom_item_id', 'bi.id')
        .where('di.delivery_order_id', deliveryOrderId);

      if (deliveryItems.length === 0) {
        throw new BadRequestException('No delivery items found for invoicing');
      }

      // Calculate invoice totals
      let subtotal = 0;
      const taxRate = invoiceData.taxRate || 0.18; // Default 18% GST

      const lineItems = deliveryItems.map(item => {
        const unitPrice = item.unit_value_inr || item.unit_cost_inr || 0;
        const lineTotal = unitPrice * item.delivery_quantity;
        const taxAmount = lineTotal * taxRate;
        
        subtotal += lineTotal;

        return {
          deliveryItemId: item.id,
          itemDescription: item.bom_description || `${item.part_number} - Delivery Item`,
          partNumber: item.part_number,
          quantity: item.delivery_quantity,
          unitPriceInr: unitPrice,
          lineTotalInr: lineTotal,
          taxRate: taxRate,
          taxAmountInr: taxAmount
        };
      });

      const totalTaxAmount = lineItems.reduce((sum, item) => sum + item.taxAmountInr, 0);
      const deliveryCharges = invoiceData.deliveryChargesInr || deliveryOrder.total_delivery_cost_inr || 0;
      const totalAmount = subtotal + totalTaxAmount + deliveryCharges;

      // Create invoice header
      const [invoice] = await trx('delivery_invoices')
        .insert({
          delivery_order_id: deliveryOrderId,
          project_id: deliveryOrder.project_id,
          invoice_date: invoiceData.invoiceDate,
          due_date: invoiceData.dueDate,
          status: 'draft',
          subtotal_inr: subtotal,
          tax_rate: taxRate,
          tax_amount_inr: totalTaxAmount,
          delivery_charges_inr: deliveryCharges,
          total_amount_inr: totalAmount,
          payment_terms: invoiceData.paymentTerms,
          bill_to_company: invoiceData.billToCompany,
          bill_to_address: invoiceData.billToAddress,
          bill_to_gstin: invoiceData.billToGstin,
          purchase_order_number: invoiceData.purchaseOrderNumber,
          project_reference: invoiceData.projectReference || deliveryOrder.project_name,
          notes: invoiceData.notes,
          created_by: userId
        })
        .returning('*');

      // Create invoice line items
      for (const lineItem of lineItems) {
        await trx('delivery_invoice_items').insert({
          invoice_id: invoice.id,
          delivery_item_id: lineItem.deliveryItemId,
          item_description: lineItem.itemDescription,
          part_number: lineItem.partNumber,
          quantity: lineItem.quantity,
          unit_price_inr: lineItem.unitPriceInr,
          line_total_inr: lineItem.lineTotalInr,
          tax_rate: lineItem.taxRate,
          tax_amount_inr: lineItem.taxAmountInr
        });
      }

      await trx.commit();

      this.logger.log(`Invoice created successfully: ${invoice.invoice_number} for delivery order: ${deliveryOrder.order_number}`);

      // Return complete invoice details
      return await this.getInvoiceById(invoice.id);

    } catch (error) {
      await trx.rollback();
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Failed to create invoice: ${error.message}`);
      throw new BadRequestException('Failed to create invoice');
    }
  }

  /**
   * Get invoice by ID with full details
   */
  async getInvoiceById(id: string): Promise<any> {
    try {
      const invoice = await this.knex('delivery_invoices as di')
        .select([
          'di.*',
          'do.order_number',
          'do.tracking_number',
          'p.name as project_name'
        ])
        .join('delivery_orders as do', 'di.delivery_order_id', 'do.id')
        .join('projects as p', 'di.project_id', 'p.id')
        .where('di.id', id)
        .first();

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      // Get invoice line items
      const lineItems = await this.knex('delivery_invoice_items as dii')
        .select([
          'dii.*',
          'di.delivery_quantity',
          'bi.material',
          'bi.unit_of_measure'
        ])
        .join('delivery_items as di', 'dii.delivery_item_id', 'di.id')
        .join('bom_items as bi', 'di.bom_item_id', 'bi.id')
        .where('dii.invoice_id', id)
        .orderBy('dii.created_at');

      return {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        deliveryOrderId: invoice.delivery_order_id,
        deliveryOrderNumber: invoice.order_number,
        projectId: invoice.project_id,
        projectName: invoice.project_name,
        trackingNumber: invoice.tracking_number,
        
        // Invoice details
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        status: invoice.status,
        
        // Financial details
        subtotalInr: parseFloat(invoice.subtotal_inr),
        taxRate: parseFloat(invoice.tax_rate),
        taxAmountInr: parseFloat(invoice.tax_amount_inr),
        deliveryChargesInr: parseFloat(invoice.delivery_charges_inr),
        totalAmountInr: parseFloat(invoice.total_amount_inr),
        
        // Payment details
        paymentTerms: invoice.payment_terms,
        paymentMethod: invoice.payment_method,
        paidAmountInr: parseFloat(invoice.paid_amount_inr || 0),
        paymentDate: invoice.payment_date,
        paymentReference: invoice.payment_reference,
        
        // Billing information
        billToCompany: invoice.bill_to_company,
        billToAddress: invoice.bill_to_address,
        billToGstin: invoice.bill_to_gstin,
        
        // References
        purchaseOrderNumber: invoice.purchase_order_number,
        projectReference: invoice.project_reference,
        
        // Line items
        lineItems: lineItems.map(item => ({
          id: item.id,
          deliveryItemId: item.delivery_item_id,
          itemDescription: item.item_description,
          partNumber: item.part_number,
          quantity: item.quantity,
          deliveryQuantity: item.delivery_quantity,
          material: item.material,
          unitOfMeasure: item.unit_of_measure,
          unitPriceInr: parseFloat(item.unit_price_inr),
          lineTotalInr: parseFloat(item.line_total_inr),
          taxRate: parseFloat(item.tax_rate),
          taxAmountInr: parseFloat(item.tax_amount_inr)
        })),
        
        // Metadata
        notes: invoice.notes,
        createdBy: invoice.created_by,
        approvedBy: invoice.approved_by,
        approvedAt: invoice.approved_at,
        sentAt: invoice.sent_at,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at
      };

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`Failed to get invoice: ${error.message}`);
      throw new BadRequestException('Failed to retrieve invoice');
    }
  }

  /**
   * Get invoices with filtering and pagination
   */
  async getInvoices(
    projectId?: string,
    status?: InvoiceStatus,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 20
  ): Promise<{ data: any[], total: number, page: number, limit: number }> {
    try {
      let query = this.knex('delivery_invoices as di')
        .select([
          'di.*',
          'do.order_number',
          'do.tracking_number',
          'p.name as project_name'
        ])
        .join('delivery_orders as do', 'di.delivery_order_id', 'do.id')
        .join('projects as p', 'di.project_id', 'p.id');

      // Apply filters
      if (projectId) {
        query = query.where('di.project_id', projectId);
      }

      if (status) {
        query = query.where('di.status', status);
      }

      if (startDate && endDate) {
        query = query.whereBetween('di.invoice_date', [startDate, endDate]);
      }

      // Get total count
      const totalQuery = query.clone().clearSelect().count('di.id as count');
      const [{ count }] = await totalQuery;
      const total = parseInt(count as string);

      // Apply pagination and sorting
      query = query
        .orderBy('di.invoice_date', 'desc')
        .orderBy('di.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit);

      const invoices = await query;

      const data = invoices.map(invoice => ({
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        deliveryOrderId: invoice.delivery_order_id,
        deliveryOrderNumber: invoice.order_number,
        projectId: invoice.project_id,
        projectName: invoice.project_name,
        trackingNumber: invoice.tracking_number,
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        status: invoice.status,
        billToCompany: invoice.bill_to_company,
        totalAmountInr: parseFloat(invoice.total_amount_inr),
        paidAmountInr: parseFloat(invoice.paid_amount_inr || 0),
        balanceAmountInr: parseFloat(invoice.total_amount_inr) - parseFloat(invoice.paid_amount_inr || 0),
        paymentTerms: invoice.payment_terms,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at
      }));

      return { data, total, page, limit };

    } catch (error) {
      this.logger.error(`Failed to get invoices: ${error.message}`);
      throw new BadRequestException('Failed to retrieve invoices');
    }
  }

  /**
   * Update invoice status
   */
  async updateInvoiceStatus(
    id: string,
    status: InvoiceStatus,
    userId: string,
    metadata?: any
  ): Promise<any> {
    try {
      const invoice = await this.knex('delivery_invoices')
        .where('id', id)
        .first();

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      const updateData: any = {
        status,
        updated_at: new Date()
      };

      // Handle status-specific updates
      switch (status) {
        case InvoiceStatus.SENT:
          updateData.sent_at = new Date();
          break;
        
        case InvoiceStatus.PAID:
          if (metadata?.paymentAmount && metadata?.paymentDate && metadata?.paymentReference) {
            updateData.paid_amount_inr = metadata.paymentAmount;
            updateData.payment_date = metadata.paymentDate;
            updateData.payment_reference = metadata.paymentReference;
            updateData.payment_method = metadata.paymentMethod;
          }
          break;
      }

      await this.knex('delivery_invoices')
        .where('id', id)
        .update(updateData);

      this.logger.log(`Invoice ${invoice.invoice_number} status updated to ${status}`);

      return await this.getInvoiceById(id);

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      
      this.logger.error(`Failed to update invoice status: ${error.message}`);
      throw new BadRequestException('Failed to update invoice status');
    }
  }

  /**
   * Record payment against invoice
   */
  async recordPayment(
    id: string,
    paymentAmount: number,
    paymentDate: Date,
    paymentReference: string,
    paymentMethod: string,
    userId: string
  ): Promise<any> {
    try {
      const invoice = await this.knex('delivery_invoices')
        .where('id', id)
        .first();

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      const currentPaidAmount = parseFloat(invoice.paid_amount_inr || 0);
      const totalAmount = parseFloat(invoice.total_amount_inr);
      const newPaidAmount = currentPaidAmount + paymentAmount;

      if (newPaidAmount > totalAmount) {
        throw new BadRequestException('Payment amount exceeds invoice total');
      }

      const newStatus = newPaidAmount >= totalAmount ? InvoiceStatus.PAID : invoice.status;

      await this.knex('delivery_invoices')
        .where('id', id)
        .update({
          paid_amount_inr: newPaidAmount,
          payment_date: paymentDate,
          payment_reference: paymentReference,
          payment_method: paymentMethod,
          status: newStatus,
          updated_at: new Date()
        });

      this.logger.log(`Payment of ₹${paymentAmount} recorded for invoice ${invoice.invoice_number}`);

      return await this.getInvoiceById(id);

    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      
      this.logger.error(`Failed to record payment: ${error.message}`);
      throw new BadRequestException('Failed to record payment');
    }
  }

  /**
   * Get invoice analytics/metrics
   */
  async getInvoiceMetrics(projectId?: string, startDate?: Date, endDate?: Date): Promise<any> {
    try {
      let query = this.knex('delivery_invoices');

      if (projectId) {
        query = query.where('project_id', projectId);
      }

      if (startDate && endDate) {
        query = query.whereBetween('invoice_date', [startDate, endDate]);
      }

      const metrics = await query
        .select([
          this.knex.raw('COUNT(*) as total_invoices'),
          this.knex.raw('COUNT(*) FILTER (WHERE status = ?) as paid_invoices', [InvoiceStatus.PAID]),
          this.knex.raw('COUNT(*) FILTER (WHERE status = ?) as pending_invoices', [InvoiceStatus.PENDING]),
          this.knex.raw('COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN (?, ?)) as overdue_invoices', [InvoiceStatus.PAID, InvoiceStatus.CANCELLED]),
          this.knex.raw('SUM(total_amount_inr) as total_invoice_amount'),
          this.knex.raw('SUM(paid_amount_inr) as total_paid_amount'),
          this.knex.raw('AVG(total_amount_inr) as avg_invoice_amount'),
          this.knex.raw('AVG(EXTRACT(DAY FROM (payment_date - invoice_date))) FILTER (WHERE status = ?) as avg_payment_days', [InvoiceStatus.PAID])
        ])
        .first();

      const totalInvoices = parseInt(metrics.total_invoices);
      const paidInvoices = parseInt(metrics.paid_invoices);
      const pendingInvoices = parseInt(metrics.pending_invoices);
      const overdueInvoices = parseInt(metrics.overdue_invoices);

      const totalInvoiceAmount = parseFloat(metrics.total_invoice_amount || 0);
      const totalPaidAmount = parseFloat(metrics.total_paid_amount || 0);
      const outstandingAmount = totalInvoiceAmount - totalPaidAmount;

      return {
        totalInvoices,
        paidInvoices,
        pendingInvoices,
        overdueInvoices,
        collectionRate: totalInvoices > 0 ? ((paidInvoices / totalInvoices) * 100).toFixed(2) : 0,
        totalInvoiceAmount,
        totalPaidAmount,
        outstandingAmount,
        avgInvoiceAmount: parseFloat(metrics.avg_invoice_amount || 0),
        avgPaymentDays: parseFloat(metrics.avg_payment_days || 0)
      };

    } catch (error) {
      this.logger.error(`Failed to get invoice metrics: ${error.message}`);
      throw new BadRequestException('Failed to retrieve invoice metrics');
    }
  }

  /**
   * Generate invoice PDF (placeholder for PDF generation service)
   */
  async generateInvoicePDF(id: string): Promise<Buffer> {
    // This would integrate with a PDF generation service
    // For now, returning placeholder
    throw new BadRequestException('PDF generation not implemented yet');
  }
}