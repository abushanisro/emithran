import { BadRequestException } from '@nestjs/common';

import { InvoiceStatus } from '../dto/delivery.dto';
import { InvoiceService } from './invoice.service';

// A table-keyed fake of the Supabase client: every query chain resolves to that table's canned answer, and writes are recorded.
function fakeDb(tables: Record<string, { data?: unknown; error?: { message: string } | null; count?: number }>) {
  const writes: Array<[string, string, unknown]> = [];
  const db = {
    from: (table: string) => {
      const answer = () => ({ data: null, error: null, ...tables[table] });
      const chain: any = new Proxy(() => undefined, {
        get: (_t, prop) => {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(answer());
          if (prop === 'maybeSingle' || prop === 'single') return async () => answer();
          if (prop === 'insert' || prop === 'update' || prop === 'delete') return (payload?: unknown) => { writes.push([table, String(prop), payload]); return chain; };
          return () => chain;
        },
      });
      return chain;
    },
  };
  const service = new InvoiceService({ getPrivilegedClient: () => db } as never);
  return { service, writes };
}

describe('InvoiceService (Supabase client, no direct database connection)', () => {
  it('removes the header when the lines cannot be written, so no half-made invoice remains', async () => {
    const writes: Array<[string, string, unknown]> = [];
    const service = new InvoiceService({ getPrivilegedClient: () => fakeDbWithHeader(writes).db } as never);
    await expect(
      service.createInvoiceFromDeliveryOrder('o1', { invoiceDate: '2026-10-29', dueDate: '2026-11-29' } as never, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writes).toContainEqual(['delivery_invoices', 'delete', undefined]);
  });

  it('computes metrics from the rows: totals, overdue (past due and unpaid) and collection rate', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { service } = fakeDb({
      delivery_invoices: {
        data: [
          { status: InvoiceStatus.PAID, due_date: yesterday, invoice_date: '2026-10-01', payment_date: '2026-10-11', total_amount_inr: 100, paid_amount_inr: 100 },
          { status: InvoiceStatus.PENDING, due_date: yesterday, invoice_date: '2026-10-02', payment_date: null, total_amount_inr: 300, paid_amount_inr: 0 },
        ],
      },
    });
    await expect(service.getInvoiceMetrics()).resolves.toMatchObject({
      totalInvoices: 2,
      paidInvoices: 1,
      pendingInvoices: 1,
      overdueInvoices: 1,
      collectionRate: '50.00',
      totalInvoiceAmount: 400,
      outstandingAmount: 300,
      avgPaymentDays: 10,
    });
  });

  it('rejects a payment that would exceed the invoice total', async () => {
    const { service } = fakeDb({ delivery_invoices: { data: { id: 'i1', total_amount_inr: 100, paid_amount_inr: 80, status: 'sent' } } });
    await expect(service.recordPayment('i1', 30, new Date(), 'ref', 'upi', 'u1')).rejects.toThrow('exceeds invoice total');
  });
});

// The header insert returns a row; every other call on delivery_invoices (the duplicate check) finds nothing.
function fakeDbWithHeader(writes: Array<[string, string, unknown]>) {
  const answers: Record<string, unknown> = {
    delivery_orders: { data: { id: 'o1', project_id: 'p1', status: 'delivered', total_delivery_cost_inr: 0, order_number: 'DO-1' } },
    delivery_items: { data: [{ id: 'd1', bom_item_id: 'b1', delivery_quantity: 1, unit_value_inr: 10 }] },
    bom_items: { data: [{ id: 'b1', part_number: 'P-1', description: 'x', unit_cost_inr: 1 }] },
    projects: { data: { name: 'Proj' } },
    delivery_invoice_items: { error: { message: 'boom' } },
  };
  const db = {
    from: (table: string) => {
      let inserted = false;
      const answer = () => ({ data: null, error: null, ...(answers[table] as object), ...(table === 'delivery_invoices' && inserted ? { data: { id: 'i1', invoice_number: 'INV-1' } } : {}) });
      const chain: any = new Proxy(() => undefined, {
        get: (_t, prop) => {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(answer());
          if (prop === 'maybeSingle' || prop === 'single') return async () => answer();
          if (prop === 'insert' || prop === 'update' || prop === 'delete') return (payload?: unknown) => { inserted = prop === 'insert'; writes.push([table, String(prop), payload]); return chain; };
          return () => chain;
        },
      });
      return chain;
    },
  };
  return { db };
}
