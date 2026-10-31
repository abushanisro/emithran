// Regression (2026-10-27, security audit): RFQ attachments passed the stored
// bom_items.file_2d_path / file_3d_path to nodemailer as `path`. Those columns
// are client-writable (PUT /bom-items/:id), and nodemailer reads a `path` from
// the server's disk or fetches it as a URL — so any user could set a path to
// /proc/self/environ, send an RFQ to their own address and receive the server's
// secrets. Attachments are now storage downloads made with the caller's client,
// sent as bytes, and the transport refuses file and URL attachments.
import { RfqEmailService } from '../../../../modules/rfq/services/rfq-email.service';
import { type SupabaseService } from '../../../../common/supabase/supabase.service';

describe('RfqEmailService attachments', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SMTP_USER = 'rfq@example.com';
    process.env.SMTP_PASS = 'x';
  });
  afterEach(() => { process.env = { ...env }; });

  function setup(objects: Record<string, string>, readable = true) {
    const get = jest.fn(async (_bucket: string, p: string) => (p in objects ? Buffer.from(objects[p]) : null));
    const canRead = jest.fn(async () => readable);
    const supabaseService = {
      getUserClient: jest.fn(),
      getPrivilegedClient: jest.fn(() => { throw new Error('attachments must not use the privileged client'); }),
    } as unknown as SupabaseService;
    const service = new RfqEmailService(supabaseService, { canRead } as never, { get } as never);
    return { service, supabaseService, get, canRead };
  }

  it('locks the transport against file and URL attachments', () => {
    const { service } = setup({});
    const options = (service as any).transporter.options;
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
  });

  it('attaches storage objects as bytes, after checking the caller may read them', async () => {
    const { service, get, canRead } = setup({ 'u1/p1/bom-items/i1/2d/a.pdf': 'PDF' });
    const attachments = await (service as any).prepareFileAttachments(
      [{ id: 'i1', name: 'Bracket', itemType: 'part', quantity: 1, file2dPath: 'u1/p1/bom-items/i1/2d/a.pdf' }],
      'token-abc',
    );
    expect(canRead).toHaveBeenCalledWith('u1/p1/bom-items/i1/2d/a.pdf', 'token-abc');
    expect(get).toHaveBeenCalledWith('bom-files', 'u1/p1/bom-items/i1/2d/a.pdf');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].path).toBeUndefined();
    expect(Buffer.isBuffer(attachments[0].content)).toBe(true);
    expect(attachments[0].content.toString()).toBe('PDF');
  });

  it('never reads a file the caller may not read (another tenant\'s object), even though it exists', async () => {
    const { service, get } = setup({ 'other/p/x/f.pdf': 'SECRET' }, false);
    const attachments = await (service as any).prepareFileAttachments(
      [{ id: 'i1', name: 'x', itemType: 'part', quantity: 1, file2dPath: 'other/p/x/f.pdf' }],
      'token-abc',
    );
    expect(attachments).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('never attaches a server file or URL written into the path columns', async () => {
    const { service } = setup({});
    const attachments = await (service as any).prepareFileAttachments(
      [{ id: 'i1', name: 'x', itemType: 'part', quantity: 1,
         file2dPath: '/proc/self/environ', file3dPath: 'http://169.254.169.254/latest/meta-data/' }],
      'token-abc',
    );
    expect(attachments).toEqual([]);
  });
});

describe('RfqEmailService email content', () => {
  it('links only to the reply address: the vendor portal route does not exist', async () => {
    process.env.SMTP_USER = 'rfq@example.com';
    process.env.SMTP_PASS = 'x';
    process.env.FRONTEND_URL = 'https://app.example.com';
    const service = new RfqEmailService({} as never, {} as never, {} as never);
    const rfq = { id: 'r1', rfqNumber: 'RFQ-1', rfqName: 'Brackets', selectionType: 'single', bomItemIds: [], vendorIds: [] };
    const items = [{ id: 'i1', name: 'Bracket', partNumber: 'P-1', itemType: 'part', quantity: 2, file2dPath: 'u/p/a.pdf' }];
    const vendor = { id: 'v1', name: 'Vendor', companyEmail: 'v@example.com' };
    const { html, text } = await (service as any).generateEmailTemplate(rfq, items, vendor);
    expect(html).not.toContain('vendor-portal');
    expect(text).not.toContain('vendor-portal');
    expect(html).toContain('mailto:rfq@example.com?subject=Re: RFQ-1');
    expect(html).toContain('drawings and 3D models are attached');
  });
});
