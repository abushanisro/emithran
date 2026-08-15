import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { CreateVendorQuoteDto, UpdateVendorQuoteDto, VendorQuoteLineItemDto, VendorAssignmentDto } from './dto/vendor-quotes.dto';

@Injectable()
export class VendorQuotesService {
  constructor(private readonly supabaseService: SupabaseService) { }

  private throwDisabledError() {
    throw new BadRequestException('VendorQuotes service temporarily disabled - needs Supabase migration');
  }

  async createQuote(createQuoteDto: CreateVendorQuoteDto, userId: string) {
    this.throwDisabledError();
  }

  async getQuotesByNomination(nominationId: string, userId: string, status?: string) {
    this.throwDisabledError();
  }

  async getQuoteById(id: string, userId: string) {
    this.throwDisabledError();
  }

  async updateQuote(id: string, updateQuoteDto: UpdateVendorQuoteDto, userId: string) {
    this.throwDisabledError();
  }

  async deleteQuote(id: string, userId: string) {
    this.throwDisabledError();
  }

  async addLineItem(quoteId: string, lineItemDto: VendorQuoteLineItemDto, userId: string) {
    this.throwDisabledError();
  }

  async updateLineItem(quoteId: string, lineItemId: string, lineItemDto: VendorQuoteLineItemDto, userId: string) {
    this.throwDisabledError();
  }

  async deleteLineItem(quoteId: string, lineItemId: string, userId: string) {
    this.throwDisabledError();
  }

  async submitQuote(id: string, userId: string) {
    this.throwDisabledError();
  }

  async approveQuote(id: string, userId: string, reviewNotes?: string) {
    this.throwDisabledError();
  }

  async rejectQuote(id: string, userId: string, reviewNotes: string) {
    this.throwDisabledError();
  }

  async compareQuotesForBomItem(nominationId: string, bomItemId: string, userId: string) {
    this.throwDisabledError();
  }

  async assignVendorToBomPart(assignmentDto: VendorAssignmentDto, userId: string) {
    this.throwDisabledError();
  }

  async getVendorAssignments(nominationId: string, userId: string) {
    this.throwDisabledError();
  }

  async getVendorAssignmentById(id: string, userId: string) {
    this.throwDisabledError();
  }

  async updateVendorAssignment(assignmentId: string, updateData: Partial<VendorAssignmentDto>, userId: string) {
    this.throwDisabledError();
  }

  async calculateCompetitivenessScores(nominationId: string, bomItemId: string, userId: string) {
    this.throwDisabledError();
  }

  async getQuotesDashboard(nominationId: string, userId: string, includeUnquoted: boolean = false) {
    this.throwDisabledError();
  }
}