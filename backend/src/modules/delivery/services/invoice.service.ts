import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { CreateDeliveryInvoiceDto, InvoiceStatus } from '../dto/delivery.dto';

const num = (value: unknown): number => parseFloat(String(value ?? 0)) || 0;

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // Same access as the rest of the delivery module (see DeliveryService): the delivery_* tables carry no tenancy column or RLS
  // policies yet, so every call goes through the service role until the isolation migration lands.
  private db() {
    return this.supabase.getPrivilegedClient('delivery: OPEN RISK no tenancy column or RLS policies on delivery_* tables, isolation migration pending');
  }

  /** Create an invoice (header and lines) from a delivered delivery order. */
  async createInvoiceFromDeliveryOrder(deliveryOrderId: string, invoiceData: CreateDeliveryInvoiceDto, userId: string): Promise<any> {
    const { data: order } = await this.db().from('delivery_orders').select('*').eq('id', deliveryOrderId).maybeSingle();
    if (!order) throw new NotFoundException('Delivery order not found');
    if (order.status !== 'delivered') throw new BadRequestException('Can only create invoice for delivered orders');

    const { data: existing } = await this.db().from('delivery_invoices').select('id').eq('delivery_order_id', deliveryOrderId).maybeSingle();
    if (existing) throw new BadRequestException('Invoice already exists for this delivery order');

    const { data: items } = await this.db().from('delivery_items').select('*').eq('delivery_order_id', deliveryOrderId);
    if (!items?.length) throw new BadRequestException('No delivery items found for invoicing');
    const { data: parts } = await this.db()
      .from('bom_items')
      .select('id, part_number, description, unit_cost_inr')
      .in('id', items.map((item) => item.bom_item_id));
    const partById = new Map((parts ?? []).map((part) => [part.id, part]));
    const { data: project } = await this.db().from('projects').select('name').eq('id', order.project_id).maybeSingle();

    const taxRate = invoiceData.taxRate || 0.18; // default 18% GST
    const lines = items.map((item) => {
      const part = partById.get(item.bom_item_id);
      const unitPrice = num(item.unit_value_inr) || num(part?.unit_cost_inr);
      const lineTotal = unitPrice * item.delivery_quantity;
      return {
        delivery_item_id: item.id,
        item_description: part?.description || `${part?.part_number} - Delivery Item`,
        part_number: part?.part_number,
        quantity: item.delivery_quantity,
        unit_price_inr: unitPrice,
        line_total_inr: lineTotal,
        tax_rate: taxRate,
        tax_amount_inr: lineTotal * taxRate,
      };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.line_total_inr, 0);
    const tax = lines.reduce((sum, line) => sum + line.tax_amount_inr, 0);
    const deliveryCharges = invoiceData.deliveryChargesInr || num(order.total_delivery_cost_inr);

    const { data: invoice, error } = await this.db()
      .from('delivery_invoices')
      .insert({
        delivery_order_id: deliveryOrderId,
        project_id: order.project_id,
        invoice_date: invoiceData.invoiceDate,
        due_date: invoiceData.dueDate,
        status: 'draft',
        subtotal_inr: subtotal,
        tax_rate: taxRate,
        tax_amount_inr: tax,
        delivery_charges_inr: deliveryCharges,
        total_amount_inr: subtotal + tax + deliveryCharges,
        payment_terms: invoiceData.paymentTerms,
        bill_to_company: invoiceData.billToCompany,
        bill_to_address: invoiceData.billToAddress,
        bill_to_gstin: invoiceData.billToGstin,
        purchase_order_number: invoiceData.purchaseOrderNumber,
        project_reference: invoiceData.projectReference || project?.name,
        notes: invoiceData.notes,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !invoice) {
      this.logger.error(`Failed to create invoice: ${error?.message}`);
      throw new BadRequestException('Failed to create invoice');
    }

    // No transaction over the API: if the lines cannot be written, the header is removed so no half-made invoice is left.
    const written = await this.db().from('delivery_invoice_items').insert(lines.map((line) => ({ ...line, invoice_id: invoice.id })));
    if (written.error) {
      await this.db().from('delivery_invoices').delete().eq('id', invoice.id);
      this.logger.error(`Failed to create invoice lines: ${written.error.message}`);
      throw new BadRequestException('Failed to create invoice');
    }

    this.logger.log(`Invoice created: ${invoice.invoice_number} for delivery order ${order.order_number}`);
    return this.getInvoiceById(invoice.id);
  }

  /** One invoice with its order, project and line items. */
  async getInvoiceById(id: string): Promise<any> {
    const { data: invoice, error } = await this.db().from('delivery_invoices').select('*').eq('id', id).maybeSingle();
    if (error) throw new BadRequestException('Failed to retrieve invoice');
    if (!invoice) throw new NotFoundException('Invoice not found');

    const [orders, projects, lines] = await Promise.all([
      this.db().from('delivery_orders').select('order_number, tracking_number').eq('id', invoice.delivery_order_id).maybeSingle(),
      this.db().from('projects').select('name').eq('id', invoice.project_id).maybeSingle(),
      this.db().from('delivery_invoice_items').select('*').eq('invoice_id', id).order('created_at'),
    ]);
    const lineRows = lines.data ?? [];
    const { data: deliveryItems } = await this.db()
      .from('delivery_items')
      .select('id, delivery_quantity, bom_item_id')
      .in('id', lineRows.map((line) => line.delivery_item_id));
    const { data: parts } = await this.db()
      .from('bom_items')
      .select('id, material, unit_of_measure')
      .in('id', (deliveryItems ?? []).map((item) => item.bom_item_id));
    const itemById = new Map((deliveryItems ?? []).map((item) => [item.id, item]));
    const partById = new Map((parts ?? []).map((part) => [part.id, part]));

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      deliveryOrderId: invoice.delivery_order_id,
      deliveryOrderNumber: orders.data?.order_number,
      projectId: invoice.project_id,
      projectName: projects.data?.name,
      trackingNumber: orders.data?.tracking_number,
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      status: invoice.status,
      subtotalInr: num(invoice.subtotal_inr),
      taxRate: num(invoice.tax_rate),
      taxAmountInr: num(invoice.tax_amount_inr),
      deliveryChargesInr: num(invoice.delivery_charges_inr),
      totalAmountInr: num(invoice.total_amount_inr),
      paymentTerms: invoice.payment_terms,
      paymentMethod: invoice.payment_method,
      paidAmountInr: num(invoice.paid_amount_inr),
      paymentDate: invoice.payment_date,
      paymentReference: invoice.payment_reference,
      billToCompany: invoice.bill_to_company,
      billToAddress: invoice.bill_to_address,
      billToGstin: invoice.bill_to_gstin,
      purchaseOrderNumber: invoice.purchase_order_number,
      projectReference: invoice.project_reference,
      lineItems: lineRows.map((line) => {
        const item = itemById.get(line.delivery_item_id);
        const part = item ? partById.get(item.bom_item_id) : undefined;
        return {
          id: line.id,
          deliveryItemId: line.delivery_item_id,
          itemDescription: line.item_description,
          partNumber: line.part_number,
          quantity: line.quantity,
          deliveryQuantity: item?.delivery_quantity,
          material: part?.material,
          unitOfMeasure: part?.unit_of_measure,
          unitPriceInr: num(line.unit_price_inr),
          lineTotalInr: num(line.line_total_inr),
          taxRate: num(line.tax_rate),
          taxAmountInr: num(line.tax_amount_inr),
        };
      }),
      notes: invoice.notes,
      createdBy: invoice.created_by,
      approvedBy: invoice.approved_by,
      approvedAt: invoice.approved_at,
      sentAt: invoice.sent_at,
      createdAt: invoice.created_at,
      updatedAt: invoice.updated_at,
    };
  }

  /** Invoices, newest first, with optional project, status and date filters. */
  async getInvoices(
    projectId?: string,
    status?: InvoiceStatus,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    let query = this.db().from('delivery_invoices').select('*', { count: 'exact' });
    if (projectId) query = query.eq('project_id', projectId);
    if (status) query = query.eq('status', status);
    if (startDate && endDate) query = query.gte('invoice_date', startDate.toISOString()).lte('invoice_date', endDate.toISOString());
    const { data, count, error } = await query
      .order('invoice_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) {
      this.logger.error(`Failed to get invoices: ${error.message}`);
      throw new BadRequestException('Failed to retrieve invoices');
    }

    const rows = data ?? [];
    const [orders, projects] = await Promise.all([
      this.db().from('delivery_orders').select('id, order_number, tracking_number').in('id', rows.map((row) => row.delivery_order_id)),
      this.db().from('projects').select('id, name').in('id', rows.map((row) => row.project_id)),
    ]);
    const orderById = new Map((orders.data ?? []).map((order) => [order.id, order]));
    const projectById = new Map((projects.data ?? []).map((project) => [project.id, project]));

    return {
      data: rows.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        deliveryOrderId: invoice.delivery_order_id,
        deliveryOrderNumber: orderById.get(invoice.delivery_order_id)?.order_number,
        projectId: invoice.project_id,
        projectName: projectById.get(invoice.project_id)?.name,
        trackingNumber: orderById.get(invoice.delivery_order_id)?.tracking_number,
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        status: invoice.status,
        billToCompany: invoice.bill_to_company,
        totalAmountInr: num(invoice.total_amount_inr),
        paidAmountInr: num(invoice.paid_amount_inr),
        balanceAmountInr: num(invoice.total_amount_inr) - num(invoice.paid_amount_inr),
        paymentTerms: invoice.payment_terms,
        createdAt: invoice.created_at,
        updatedAt: invoice.updated_at,
      })),
      total: count ?? 0,
      page,
      limit,
    };
  }

  async updateInvoiceStatus(id: string, status: InvoiceStatus, userId: string, metadata?: any): Promise<any> {
    const invoice = await this.requireInvoice(id);
    const update: Record<string, unknown> = { status, updated_at: new Date() };
    if (status === InvoiceStatus.SENT) update.sent_at = new Date();
    if (status === InvoiceStatus.PAID && metadata?.paymentAmount && metadata?.paymentDate && metadata?.paymentReference) {
      update.paid_amount_inr = metadata.paymentAmount;
      update.payment_date = metadata.paymentDate;
      update.payment_reference = metadata.paymentReference;
      update.payment_method = metadata.paymentMethod;
    }
    const { error } = await this.db().from('delivery_invoices').update(update).eq('id', id);
    if (error) {
      this.logger.error(`Failed to update invoice status: ${error.message}`);
      throw new BadRequestException('Failed to update invoice status');
    }
    this.logger.log(`Invoice ${invoice.invoice_number} status updated to ${status}`);
    return this.getInvoiceById(id);
  }

  async recordPayment(id: string, paymentAmount: number, paymentDate: Date, paymentReference: string, paymentMethod: string, userId: string): Promise<any> {
    const invoice = await this.requireInvoice(id);
    const total = num(invoice.total_amount_inr);
    const paid = num(invoice.paid_amount_inr) + paymentAmount;
    if (paid > total) throw new BadRequestException('Payment amount exceeds invoice total');

    const { error } = await this.db()
      .from('delivery_invoices')
      .update({
        paid_amount_inr: paid,
        payment_date: paymentDate,
        payment_reference: paymentReference,
        payment_method: paymentMethod,
        status: paid >= total ? InvoiceStatus.PAID : invoice.status,
        updated_at: new Date(),
      })
      .eq('id', id);
    if (error) {
      this.logger.error(`Failed to record payment: ${error.message}`);
      throw new BadRequestException('Failed to record payment');
    }
    this.logger.log(`Payment of ₹${paymentAmount} recorded for invoice ${invoice.invoice_number}`);
    return this.getInvoiceById(id);
  }

  /** Totals and collection figures, computed from the invoice rows. */
  async getInvoiceMetrics(projectId?: string, startDate?: Date, endDate?: Date): Promise<any> {
    let query = this.db().from('delivery_invoices').select('status, due_date, invoice_date, payment_date, total_amount_inr, paid_amount_inr');
    if (projectId) query = query.eq('project_id', projectId);
    if (startDate && endDate) query = query.gte('invoice_date', startDate.toISOString()).lte('invoice_date', endDate.toISOString());
    const { data, error } = await query;
    if (error) {
      this.logger.error(`Failed to get invoice metrics: ${error.message}`);
      throw new BadRequestException('Failed to retrieve invoice metrics');
    }

    const rows = data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const paid = rows.filter((row) => row.status === InvoiceStatus.PAID);
    const totalInvoiceAmount = rows.reduce((sum, row) => sum + num(row.total_amount_inr), 0);
    const totalPaidAmount = rows.reduce((sum, row) => sum + num(row.paid_amount_inr), 0);
    const paymentDays = paid
      .filter((row) => row.payment_date && row.invoice_date)
      .map((row) => (new Date(row.payment_date).getTime() - new Date(row.invoice_date).getTime()) / 86_400_000);

    return {
      totalInvoices: rows.length,
      paidInvoices: paid.length,
      pendingInvoices: rows.filter((row) => row.status === InvoiceStatus.PENDING).length,
      overdueInvoices: rows.filter((row) => row.due_date && row.due_date < today && row.status !== InvoiceStatus.PAID && row.status !== InvoiceStatus.CANCELLED).length,
      collectionRate: rows.length > 0 ? ((paid.length / rows.length) * 100).toFixed(2) : 0,
      totalInvoiceAmount,
      totalPaidAmount,
      outstandingAmount: totalInvoiceAmount - totalPaidAmount,
      avgInvoiceAmount: rows.length > 0 ? totalInvoiceAmount / rows.length : 0,
      avgPaymentDays: paymentDays.length > 0 ? paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length : 0,
    };
  }

  async generateInvoicePDF(id: string): Promise<Buffer> {
    throw new BadRequestException('PDF generation not implemented yet');
  }

  private async requireInvoice(id: string): Promise<any> {
    const { data } = await this.db().from('delivery_invoices').select('*').eq('id', id).maybeSingle();
    if (!data) throw new NotFoundException('Invoice not found');
    return data;
  }
}
