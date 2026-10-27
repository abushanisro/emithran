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

  function setup(objects: Record<string, string>) {
    const download = jest.fn(async (p: string) =>
      p in objects
        ? { data: new Blob([objects[p]]), error: null }
        : { data: null, error: { message: 'Object not found' } });
    const from = jest.fn().mockReturnValue({ download });
    const supabaseService = {
      getUserClient: jest.fn().mockReturnValue({ storage: { from } }),
      getPrivilegedClient: jest.fn(() => { throw new Error('attachments must not use the privileged client'); }),
    } as unknown as SupabaseService;
    const service = new RfqEmailService(supabaseService);
    return { service, supabaseService, download };
  }

  it('locks the transport against file and URL attachments', () => {
    const { service } = setup({});
    const options = (service as any).transporter.options;
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
  });

  it('attaches storage objects as bytes, read with the caller\'s client', async () => {
    const { service, supabaseService, download } = setup({ 'u1/p1/bom-items/i1/2d/a.pdf': 'PDF' });
    const attachments = await (service as any).prepareFileAttachments(
      [{ id: 'i1', name: 'Bracket', itemType: 'part', quantity: 1, file2dPath: 'u1/p1/bom-items/i1/2d/a.pdf' }],
      'token-abc',
    );
    expect(supabaseService.getUserClient).toHaveBeenCalledWith('token-abc');
    expect(download).toHaveBeenCalledWith('u1/p1/bom-items/i1/2d/a.pdf');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].path).toBeUndefined();
    expect(Buffer.isBuffer(attachments[0].content)).toBe(true);
    expect(attachments[0].content.toString()).toBe('PDF');
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
