import { Injectable, BadRequestException, Inject, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../common/database/database.service';
import { BomFileAccess } from '../../../common/storage/bom-file-access';
import { OBJECT_STORE, type ObjectStore } from '../../../common/storage/object-store';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import * as path from 'path';
import { RfqRecord } from '../dto/rfq-response.dto';

const BOM_FILES_BUCKET = process.env.SUPABASE_BUCKET_BOM_FILES || 'bom-files';
// Most mail servers refuse messages over ~25 MB.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Text made safe for HTML element content and quoted attributes. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BomItemDetails {
  id: string;
  name: string;
  partNumber?: string;
  description?: string;
  itemType: string;
  quantity: number;
  material?: string;
  file2dPath?: string;
  file3dPath?: string;
  processes?: string[];
}

interface VendorDetails {
  id: string;
  name: string;
  companyEmail?: string;
  primaryContacts?: Array<{
    name?: string;
    email?: string;
    phone?: string;
    role?: string;
  }>;
  process?: string[];
  location?: string;
  city?: string;
  state?: string;
}

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class RfqEmailService {
  private readonly logger = new Logger(RfqEmailService.name);
  private transporter: Transporter;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly fileAccess: BomFileAccess,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore,
  ) {
    // Only initialize if SMTP credentials are provided
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.initializeTransporter();
    } else {
      this.logger.warn('SMTP credentials not configured. RFQ emails will not be sent.');
    }
  }

  private initializeTransporter() {
    try {
      // Configure based on your email service (Gmail, SendGrid, AWS SES, etc.)
      this.transporter = createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        // Attachments are always in-memory bytes (prepareFileAttachments). Never
        // let a stored value make nodemailer read a server file or fetch a URL.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      
      this.logger.log('Email transporter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize email transporter:', error);
    }
  }

  async sendRfqEmails(rfq: RfqRecord, accessToken?: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Skipping RFQ email send for ${rfq.rfqNumber} - Email not configured`);
      return;
    }

    try {
      this.logger.log(`Starting RFQ email send process for RFQ ${rfq.rfqNumber}`);

      // Fetch detailed BOM items
      const bomItems = await this.fetchBomItemDetails(rfq.bomItemIds, accessToken);

      // Fetch vendor details with email contacts
      const vendors = await this.fetchVendorDetails(rfq.vendorIds, accessToken);
      
      // The same files go to every vendor: read them from storage once.
      const attachments = await this.prepareFileAttachments(bomItems, accessToken);

      // Send individual emails to each vendor
      const emailPromises = vendors.map(vendor => this.sendIndividualRfqEmail(rfq, bomItems, vendor, attachments));
      
      await Promise.all(emailPromises);
      
      this.logger.log(`Successfully sent RFQ emails to ${vendors.length} vendors for RFQ ${rfq.rfqNumber}`);
      
    } catch (error) {
      this.logger.error(`Failed to send RFQ emails for RFQ ${rfq.rfqNumber}:`, error);
      throw new BadRequestException(`Failed to send RFQ emails: ${error.message}`);
    }
  }

  private async sendIndividualRfqEmail(
    rfq: RfqRecord, 
    bomItems: BomItemDetails[], 
    vendor: VendorDetails,
    attachments: SendMailOptions['attachments']
  ): Promise<void> {
    try {
      // Get primary email for vendor
      const vendorEmail = this.getVendorEmail(vendor);
      if (!vendorEmail) {
        this.logger.warn(`No email found for vendor ${vendor.name}, skipping`);
        return;
      }

      // Generate email content
      const emailTemplate = await this.generateEmailTemplate(rfq, bomItems, vendor);
      
      // Send email
      const mailOptions: SendMailOptions = {
        from: {
          name: process.env.COMPANY_NAME || 'Mithran Engineering',
          address: process.env.SMTP_USER || 'noreply@mithran.com'
        },
        to: vendorEmail,
        // Structured, not "Name <address>": a buyer name containing addresses or commas cannot add recipients.
        cc: rfq.buyerName ? { name: rfq.buyerName, address: process.env.BUYER_EMAIL || process.env.SMTP_USER || '' } : undefined,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text,
        attachments: attachments
      };

      await this.transporter.sendMail(mailOptions);
      
      this.logger.log(`RFQ email sent successfully to ${vendor.name} (${vendorEmail})`);
      
      // Log email activity to database
      await this.logEmailActivity(rfq.id, vendor.id, vendorEmail, 'sent');
      
    } catch (error) {
      this.logger.error(`Failed to send RFQ email to vendor ${vendor.name}:`, error);
      await this.logEmailActivity(rfq.id, vendor.id, this.getVendorEmail(vendor), 'failed', error.message);
      throw error;
    }
  }

  private async fetchBomItemDetails(bomItemIds: string[], accessToken?: string): Promise<BomItemDetails[]> {
    const { data, error } = await this.databaseService.getUserClient(accessToken)
      .from('bom_items')
      .select(`
        id,
        name,
        part_number,
        description,
        item_type,
        quantity,
        material,
        file_2d_path,
        file_3d_path
      `)
      .in('id', bomItemIds);

    if (error) {
      throw new BadRequestException(`Failed to fetch BOM items: ${error.message}`);
    }

    // Fetch process information for each BOM item
    const itemsWithProcesses = await Promise.all(
      (data || []).map(async (item) => {
        const processes = await this.getBomItemProcesses(item.item_type);
        return {
          id: item.id,
          name: item.name,
          partNumber: item.part_number,
          description: item.description,
          itemType: item.item_type,
          quantity: item.quantity,
          material: item.material,
          file2dPath: item.file_2d_path,
          file3dPath: item.file_3d_path,
          processes: processes
        };
      })
    );

    return itemsWithProcesses;
  }

  private async fetchVendorDetails(vendorIds: string[], accessToken?: string): Promise<VendorDetails[]> {
    const { data, error } = await this.databaseService.getUserClient(accessToken)
      .from('vendors')
      .select(`
        id,
        name,
        company_email,
        process,
        city,
        state,
        primary_contacts
      `)
      .in('id', vendorIds)
      .eq('status', 'active');

    if (error) {
      throw new BadRequestException(`Failed to fetch vendors: ${error.message}`);
    }

    return (data || []).map(vendor => ({
      id: vendor.id,
      name: vendor.name,
      companyEmail: vendor.company_email,
      primaryContacts: vendor.primary_contacts,
      process: vendor.process,
      location: vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : vendor.city || vendor.state,
      city: vendor.city,
      state: vendor.state
    }));
  }

  private async getBomItemProcesses(itemType: string): Promise<string[]> {
    // Map item types to processes based on your business logic
    const processMapping: Record<string, string[]> = {
      'assembly': ['Assembly', 'Welding', 'Fastening'],
      'sub_assembly': ['Machining', 'CNC Machining', 'CNC Turning', 'CNC Milling'],
      'child_part': ['Casting', 'Investment Casting', 'Sand Casting', 'Die Casting', 'Forging']
    };

    return processMapping[itemType] || ['General Manufacturing'];
  }

  private getVendorEmail(vendor: VendorDetails): string | null {
    // Priority: primary contact email > company email
    if (vendor.primaryContacts && vendor.primaryContacts.length > 0) {
      const primaryContact = vendor.primaryContacts.find(contact => contact.email);
      if (primaryContact?.email) {
        return primaryContact.email;
      }
    }
    
    return vendor.companyEmail || null;
  }

  private async generateEmailTemplate(
    rfq: RfqRecord, 
    bomItems: BomItemDetails[], 
    vendor: VendorDetails
  ): Promise<EmailTemplate> {
    const templateData = {
      rfqNumber: rfq.rfqNumber,
      rfqName: rfq.rfqName,
      vendorName: vendor.name,
      vendorLocation: vendor.location,
      buyerName: rfq.buyerName || 'Procurement Team',
      companyName: process.env.COMPANY_NAME || 'Mithran Engineering',
      quoteDeadline: rfq.quoteDeadline ? new Date(rfq.quoteDeadline).toLocaleDateString() : 'Please contact us',
      selectionType: rfq.selectionType,
      bomItems: bomItems.map(item => ({
        ...item,
        hasFiles: !!(item.file2dPath || item.file3dPath),
        processesText: item.processes ? item.processes.join(', ') : 'General Manufacturing'
      })),
      totalItems: bomItems.length,
      totalQuantity: bomItems.reduce((sum, item) => sum + item.quantity, 0),
      customMessage: rfq.emailBody || '',
      contactEmail: process.env.BUYER_EMAIL || process.env.SMTP_USER,
      contactPhone: process.env.COMPANY_PHONE || '+91-XXXXXXXXXX',
      currentDate: new Date().toLocaleDateString('en-IN', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    };

    const subject = rfq.emailSubject || `RFQ ${rfq.rfqNumber}: Request for Quotation - ${rfq.rfqName}`;
    
    // Every value below is user or vendor data (RFQ name, subject, message, buyer, vendor, BOM fields): escaped for HTML, and the
    // reply links are built as URLs first, so no field can add markup, links or attributes to the email.
    const e = escapeHtml;
    const mailto = `mailto:${encodeURIComponent(templateData.contactEmail ?? '').replace(/%40/g, '@')}`;
    const replyHref = `${mailto}?subject=${encodeURIComponent(`Re: ${templateData.rfqNumber}`)}`;
    const contactHref = mailto;

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${e(subject)}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 0 20px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #0f766e, #14b8a6); color: white; padding: 30px; text-align: center; }
        .content { padding: 30px; }
        .rfq-details { background: #f8fafc; border-left: 4px solid #14b8a6; padding: 20px; margin: 20px 0; border-radius: 0 5px 5px 0; }
        .bom-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .bom-table th, .bom-table td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
        .bom-table th { background: #f1f5f9; font-weight: 600; color: #475569; }
        .bom-table tr:nth-child(even) { background: #f8fafc; }
        .file-indicator { color: #059669; font-weight: 500; }
        .cta-section { background: #fef7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center; }
        .cta-button { display: inline-block; background: #0f766e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: 600; margin: 10px; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 0.9em; color: #64748b; }
        .deadline { color: #dc2626; font-weight: 600; }
        .process-tags { display: flex; flex-wrap: wrap; gap: 5px; }
        .process-tag { background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }
        @media (max-width: 600px) {
            body { padding: 10px; }
            .content { padding: 20px; }
            .bom-table { font-size: 0.9em; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${e(templateData.companyName)}</h1>
            <h2>Request for Quotation</h2>
            <p>RFQ Number: <strong>${e(templateData.rfqNumber)}</strong></p>
        </div>
        
        <div class="content">
            <h3>Dear ${e(templateData.vendorName)} Team,</h3>
            
            <p>We hope this email finds you well. ${e(templateData.companyName)} is pleased to invite you to submit a quotation for the following requirements:</p>
            
            <div class="rfq-details">
                <h4>RFQ Details</h4>
                <table style="width: 100%; border: none;">
                    <tr><td><strong>Project:</strong></td><td>${e(templateData.rfqName)}</td></tr>
                    <tr><td><strong>RFQ Number:</strong></td><td>${e(templateData.rfqNumber)}</td></tr>
                    <tr><td><strong>Quote Deadline:</strong></td><td class="deadline">${e(templateData.quoteDeadline)}</td></tr>
                    <tr><td><strong>Selection Type:</strong></td><td>${e(String(templateData.selectionType ?? '').toUpperCase())}</td></tr>
                    <tr><td><strong>Total Items:</strong></td><td>${e(templateData.totalItems)}</td></tr>
                    <tr><td><strong>Buyer Contact:</strong></td><td>${e(templateData.buyerName)}</td></tr>
                </table>
            </div>

            ${templateData.customMessage ? `<div style="background: #f0f9ff; border-left: 4px solid #0284c7; padding: 15px; margin: 20px 0;"><h4>Additional Information:</h4><p>${e(templateData.customMessage).replace(/\r?\n/g, '<br>')}</p></div>` : ''}
            
            <h4>Bill of Materials (BOM) Details</h4>
            <table class="bom-table">
                <thead>
                    <tr>
                        <th>Part Number</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Quantity</th>
                        <th>Material</th>
                        <th>Processes</th>
                        <th>Files</th>
                    </tr>
                </thead>
                <tbody>
                    ${templateData.bomItems.map(item => `
                    <tr>
                        <td><strong>${e(item.partNumber || item.name)}</strong></td>
                        <td>${e(item.description || item.name)}</td>
                        <td>${e(String(item.itemType ?? '').replace('_', ' ').toUpperCase())}</td>
                        <td>${e(item.quantity)} pcs</td>
                        <td>${e(item.material || 'TBD')}</td>
                        <td>
                            <div class="process-tags">
                                ${item.processes ? item.processes.map(p => `<span class="process-tag">${e(p)}</span>`).join('') : '<span class="process-tag">General</span>'}
                            </div>
                        </td>
                        <td>${item.hasFiles ? '<span class="file-indicator">✓ Files Attached</span>' : 'Contact for files'}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="cta-section">
                <h4>How to Respond</h4>
                <p>Please provide your detailed quotation including:</p>
                <ul style="text-align: left; display: inline-block;">
                    <li>Unit prices for each item</li>
                    <li>Total project cost</li>
                    <li>Lead times</li>
                    <li>Terms and conditions</li>
                    <li>Validity period of the quote</li>
                </ul>
                <br>
                <a href="${e(replyHref)}" class="cta-button">Reply via Email</a>
            </div>
            
            <h4>Important Notes:</h4>
            <ul>
                <li>Technical drawings and 3D models are attached to this email where available</li>
                <li>Please confirm material specifications before quoting</li>
                <li>Quality certifications may be required</li>
                <li>Delivery address and terms will be discussed upon selection</li>
                <li>This RFQ is confidential and proprietary</li>
            </ul>
            
            <p>Should you have any questions or require clarification, please don't hesitate to contact us.</p>
            
            <p>Thank you for your time and consideration. We look forward to your competitive quotation.</p>
            
            <p>Best regards,<br>
            <strong>${e(templateData.buyerName)}</strong><br>
            ${e(templateData.companyName)}<br>
            Email: <a href="${e(contactHref)}">${e(templateData.contactEmail)}</a><br>
            Phone: ${e(templateData.contactPhone)}</p>
        </div>
        
        <div class="footer">
            <p>This email was generated automatically by ${e(templateData.companyName)} RFQ System on ${e(templateData.currentDate)}</p>
            <p>© ${new Date().getFullYear()} ${e(templateData.companyName)}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
${templateData.companyName} - Request for Quotation

RFQ Number: ${templateData.rfqNumber}
Project: ${templateData.rfqName}

Dear ${templateData.vendorName} Team,

We are pleased to invite you to submit a quotation for the following requirements:

RFQ Details:
- RFQ Number: ${templateData.rfqNumber}
- Quote Deadline: ${templateData.quoteDeadline}
- Selection Type: ${templateData.selectionType}
- Total Items: ${templateData.totalItems}
- Buyer Contact: ${templateData.buyerName}

${templateData.customMessage ? `Additional Information:\n${templateData.customMessage}\n\n` : ''}

Bill of Materials:
${templateData.bomItems.map(item => 
  `- ${item.partNumber || item.name}: ${item.quantity} pcs, Type: ${item.itemType}, Processes: ${item.processesText}`
).join('\n')}

Please provide your detailed quotation including unit prices, lead times, and terms.

Contact: ${templateData.contactEmail}
Phone: ${templateData.contactPhone}

Best regards,
${templateData.buyerName}
${templateData.companyName}
    `;

    return { subject, html, text };
  }

  /**
   * The parts' drawings and models as in-memory attachments. Each stored path is a key in the BOM files bucket, read with the
   * service role only after BomFileAccess confirms the caller may read it (their own folder, a project they own): a path pointing at
   * another tenant's object, a server file or a URL is never attached.
   */
  private async prepareFileAttachments(bomItems: BomItemDetails[], accessToken?: string): Promise<NonNullable<SendMailOptions['attachments']>> {
    const attachments: NonNullable<SendMailOptions['attachments']> = [];

    for (const item of bomItems) {
      for (const [storagePath, type] of [[item.file2dPath, '2D'], [item.file3dPath, '3D']] as const) {
        if (!storagePath) continue;
        try {
          if (!(await this.fileAccess.canRead(storagePath, accessToken))) {
            this.logger.warn(`Skipped ${type} file of item ${item.id}: not readable by the sender`);
            continue;
          }
          const content = await this.objects.get(BOM_FILES_BUCKET, storagePath);
          if (!content) {
            this.logger.warn(`Skipped ${type} file of item ${item.id}: not found`);
            continue;
          }
          if (content.length > MAX_ATTACHMENT_BYTES) {
            this.logger.warn(`Skipped ${type} file of item ${item.id}: ${content.length} bytes exceeds the attachment limit`);
            continue;
          }
          attachments.push({
            filename: this.extractFileName(storagePath, item.partNumber || item.name, type),
            content,
            contentType: 'application/octet-stream',
          });
        } catch (error) {
          this.logger.warn(`Failed to attach ${type} file of item ${item.id}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    this.logger.log(`Prepared ${attachments.length} file attachments`);
    return attachments;
  }

  private extractFileName(filePath: string, partNumber: string, type: string): string {
    const originalFileName = path.basename(filePath);
    const extension = path.extname(originalFileName);

    // Create descriptive filename
    const cleanPartNumber = partNumber.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `${cleanPartNumber}_${type}${extension}`;
  }

  private async logEmailActivity(
    rfqId: string, 
    vendorId: string, 
    email: string | null, 
    status: 'sent' | 'failed', 
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.databaseService.getUserClient()
        .from('rfq_email_logs')
        .insert({
          rfq_id: rfqId,
          vendor_id: vendorId,
          email: email,
          status: status,
          error_message: errorMessage,
          sent_at: new Date().toISOString()
        });
    } catch (error) {
      this.logger.error('Failed to log email activity:', error);
    }
  }
}