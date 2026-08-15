import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  PartWiseCostAnalysisDto,
  PartWiseCostBaseDataDto,
  BulkUpdatePartWiseCostAnalysisDto,
} from '../dto/part-wise-cost-analysis.dto';

@Injectable()
export class PartWiseCostAnalysisService {
  private readonly logger = new Logger(PartWiseCostAnalysisService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Get part-wise cost analysis data for a nomination and BOM item
   */
  async getPartWiseCostAnalysis(
    userId: string,
    nominationId: string,
    bomItemId: string,
    accessToken: string
  ): Promise<{
    costAnalysis: PartWiseCostAnalysisDto[];
    baseData: PartWiseCostBaseDataDto | null;
  }> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      // Get cost analysis data for all vendors for this part
      const { data: costAnalysisData, error: costAnalysisError } = await client
        .from('part_wise_cost_analysis')
        .select('*')
        .eq('nomination_id', nominationId)
        .eq('bom_item_id', bomItemId)
        .order('overall_rank', { ascending: true });

      if (costAnalysisError) {
        this.logger.error('Failed to fetch part-wise cost analysis', costAnalysisError);
        throw new BadRequestException(`Failed to fetch cost analysis: ${costAnalysisError.message}`);
      }

      // Get base data for this part
      const { data: baseData, error: baseError } = await client
        .from('part_wise_cost_base_data')
        .select('*')
        .eq('nomination_id', nominationId)
        .eq('bom_item_id', bomItemId)
        .single();

      if (baseError && baseError.code !== 'PGRST116') { // PGRST116 = no rows found
        this.logger.error('Failed to fetch part-wise base data', baseError);
        throw new BadRequestException(`Failed to fetch base data: ${baseError.message}`);
      }

      return {
        costAnalysis: this.mapCostAnalysisData(costAnalysisData || []),
        baseData: baseData ? this.mapBaseData(baseData) : null,
      };
    } catch (error) {
      this.logger.error('Error in getPartWiseCostAnalysis', error);
      throw error;
    }
  }

  /**
   * Initialize cost analysis for a specific BOM part with all vendors from the nomination
   */
  async initializePartWiseCostAnalysis(
    userId: string,
    nominationId: string,
    bomItemId: string,
    accessToken: string
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      // Get all vendors from the nomination
      const { data: vendorEvaluations, error: vendorsError } = await client
        .from('vendor_nomination_evaluations')
        .select('vendor_id')
        .eq('nomination_evaluation_id', nominationId);

      if (vendorsError) {
        this.logger.error('Failed to fetch vendors for nomination', vendorsError);
        throw new BadRequestException(`Failed to fetch vendors: ${vendorsError.message}`);
      }

      if (!vendorEvaluations || vendorEvaluations.length === 0) {
        this.logger.warn(`No vendors found for nomination ${nominationId}`);
        return;
      }

      // Create cost analysis records for each vendor
      const costAnalysisRecords = vendorEvaluations.map(evaluation => ({
        nomination_id: nominationId,
        bom_item_id: bomItemId,
        vendor_id: evaluation.vendor_id,
        created_by: userId,
      }));

      const { error: insertError } = await client
        .from('part_wise_cost_analysis')
        .upsert(costAnalysisRecords, {
          onConflict: 'nomination_id,bom_item_id,vendor_id',
          ignoreDuplicates: true
        });

      if (insertError) {
        this.logger.error('Failed to initialize cost analysis records', insertError);
        throw new BadRequestException(`Failed to initialize cost analysis: ${insertError.message}`);
      }

      // Create base data record if it doesn't exist
      const { error: baseInsertError } = await client
        .from('part_wise_cost_base_data')
        .upsert({
          nomination_id: nominationId,
          bom_item_id: bomItemId,
          cost_factor_weight: 33.33,
          development_cost_factor_weight: 33.33,
          lead_time_factor_weight: 33.34,
          created_by: userId,
        }, {
          onConflict: 'nomination_id,bom_item_id',
          ignoreDuplicates: true
        });

      if (baseInsertError) {
        this.logger.error('Failed to initialize base data', baseInsertError);
        throw new BadRequestException(`Failed to initialize base data: ${baseInsertError.message}`);
      }

      this.logger.log(`Initialized cost analysis for nomination ${nominationId}, BOM item ${bomItemId}`);
    } catch (error) {
      this.logger.error('Error in initializePartWiseCostAnalysis', error);
      throw error;
    }
  }

  /**
   * Bulk update part-wise cost analysis data
   */
  async bulkUpdatePartWiseCostAnalysis(
    userId: string,
    nominationId: string,
    bomItemId: string,
    updateDto: BulkUpdatePartWiseCostAnalysisDto,
    accessToken: string
  ): Promise<{
    costAnalysis: PartWiseCostAnalysisDto[];
    baseData: PartWiseCostBaseDataDto | null;
  }> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      // Update base data if provided
      if (updateDto.baseData) {
        const baseDataToUpdate = {
          base_raw_material_cost: updateDto.baseData.baseRawMaterialCost,
          base_process_cost: updateDto.baseData.baseProcessCost,
          base_overheads_profit: updateDto.baseData.baseOverheadsProfit,
          base_packing_forwarding_cost: updateDto.baseData.basePackingForwardingCost,
          base_payment_terms: updateDto.baseData.basePaymentTerms,
          base_net_price_unit: updateDto.baseData.baseNetPriceUnit,
          base_development_cost: updateDto.baseData.baseDevelopmentCost,
          base_financial_risk: updateDto.baseData.baseFinancialRisk,
          base_cost_competency_score: updateDto.baseData.baseCostCompetencyScore,
          base_lead_time_days: updateDto.baseData.baseLeadTimeDays,
          cost_factor_weight: updateDto.baseData.costFactorWeight,
          development_cost_factor_weight: updateDto.baseData.developmentCostFactorWeight,
          lead_time_factor_weight: updateDto.baseData.leadTimeFactorWeight,
        };

        const { error: baseUpdateError } = await client
          .from('part_wise_cost_base_data')
          .upsert({
            nomination_id: nominationId,
            bom_item_id: bomItemId,
            ...baseDataToUpdate,
          }, {
            onConflict: 'nomination_id,bom_item_id'
          });

        if (baseUpdateError) {
          this.logger.error('Failed to update base data', baseUpdateError);
          throw new BadRequestException(`Failed to update base data: ${baseUpdateError.message}`);
        }
      }

      // Update vendor cost data
      if (updateDto.vendorCostData && updateDto.vendorCostData.length > 0) {
        const vendorDataToUpdate = updateDto.vendorCostData.map(data => ({
          nomination_id: nominationId,
          bom_item_id: bomItemId,
          vendor_id: data.vendorId,
          raw_material_cost: data.rawMaterialCost,
          process_cost: data.processCost,
          overheads_profit: data.overheadsProfit,
          packing_forwarding_cost: data.packingForwardingCost,
          payment_terms: data.paymentTerms,
          net_price_unit: data.netPriceUnit,
          development_cost: data.developmentCost,
          financial_risk: data.financialRisk,
          cost_competency_score: data.costCompetencyScore,
          lead_time_days: data.leadTimeDays,
        }));

        const { error: vendorUpdateError } = await client
          .from('part_wise_cost_analysis')
          .upsert(vendorDataToUpdate, {
            onConflict: 'nomination_id,bom_item_id,vendor_id'
          });

        if (vendorUpdateError) {
          this.logger.error('Failed to update vendor cost data', vendorUpdateError);
          throw new BadRequestException(`Failed to update vendor data: ${vendorUpdateError.message}`);
        }
      }

      // Recalculate rankings
      await this.recalculateRankings(nominationId, bomItemId, accessToken);

      // Return updated data
      return this.getPartWiseCostAnalysis(userId, nominationId, bomItemId, accessToken);
    } catch (error) {
      this.logger.error('Error in bulkUpdatePartWiseCostAnalysis', error);
      throw error;
    }
  }

  /**
   * Recalculate rankings for a specific part
   */
  private async recalculateRankings(
    nominationId: string,
    bomItemId: string,
    accessToken: string
  ): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      const { error } = await client.rpc('calculate_part_wise_rankings', {
        p_nomination_id: nominationId,
        p_bom_item_id: bomItemId,
      });

      if (error) {
        this.logger.error('Failed to recalculate rankings', error);
        throw new BadRequestException(`Failed to recalculate rankings: ${error.message}`);
      }

      this.logger.log(`Recalculated rankings for nomination ${nominationId}, BOM item ${bomItemId}`);
    } catch (error) {
      this.logger.error('Error in recalculateRankings', error);
      throw error;
    }
  }

  /**
   * Get part-wise analysis summary for dashboard
   */
  async getPartWiseAnalysisSummary(
    userId: string,
    nominationId: string,
    accessToken: string
  ): Promise<any[]> {
    const client = this.supabaseService.getClient(accessToken);

    try {
      const { data, error } = await client
        .from('part_wise_cost_analysis')
        .select(`
          bom_item_id,
          vendor_id,
          net_price_unit,
          development_cost,
          lead_time_days,
          total_score,
          overall_rank,
          bom_items!inner(name, part_number)
        `)
        .eq('nomination_id', nominationId);

      if (error) {
        this.logger.error('Failed to fetch part-wise summary', error);
        throw new BadRequestException(`Failed to fetch summary: ${error.message}`);
      }

      // Group by BOM item and calculate summary statistics
      const summaryMap = new Map();

      data?.forEach(item => {
        const bomItemId = item.bom_item_id;
        
        if (!summaryMap.has(bomItemId)) {
          summaryMap.set(bomItemId, {
            bomItemId,
            bomItemName: (item.bom_items as any)?.name || 'Unknown Part',
            partNumber: (item.bom_items as any)?.part_number || '',
            vendorCount: 0,
            vendors: [],
            lowestNetPrice: null,
            lowestDevelopmentCost: null,
            shortestLeadTime: null,
            topVendor: null,
          });
        }

        const summary = summaryMap.get(bomItemId);
        summary.vendorCount++;
        summary.vendors.push({
          vendorId: item.vendor_id,
          netPrice: item.net_price_unit,
          developmentCost: item.development_cost,
          leadTime: item.lead_time_days,
          totalScore: item.total_score,
          rank: item.overall_rank,
        });

        // Track lowest values
        if (item.net_price_unit && (summary.lowestNetPrice === null || item.net_price_unit < summary.lowestNetPrice)) {
          summary.lowestNetPrice = item.net_price_unit;
        }
        if (item.development_cost && (summary.lowestDevelopmentCost === null || item.development_cost < summary.lowestDevelopmentCost)) {
          summary.lowestDevelopmentCost = item.development_cost;
        }
        if (item.lead_time_days && (summary.shortestLeadTime === null || item.lead_time_days < summary.shortestLeadTime)) {
          summary.shortestLeadTime = item.lead_time_days;
        }

        // Track top vendor (rank 1)
        if (item.overall_rank === 1) {
          summary.topVendor = {
            vendorId: item.vendor_id,
            totalScore: item.total_score,
          };
        }
      });

      return Array.from(summaryMap.values());
    } catch (error) {
      this.logger.error('Error in getPartWiseAnalysisSummary', error);
      throw error;
    }
  }

  private mapCostAnalysisData(data: any[]): PartWiseCostAnalysisDto[] {
    return data.map(item => ({
      id: item.id,
      nominationId: item.nomination_id,
      bomItemId: item.bom_item_id,
      vendorId: item.vendor_id,
      rawMaterialCost: item.raw_material_cost,
      processCost: item.process_cost,
      overheadsProfit: item.overheads_profit,
      packingForwardingCost: item.packing_forwarding_cost,
      paymentTerms: item.payment_terms,
      netPriceUnit: item.net_price_unit,
      developmentCost: item.development_cost,
      financialRisk: item.financial_risk,
      costCompetencyScore: item.cost_competency_score,
      leadTimeDays: item.lead_time_days,
      rankCost: item.rank_cost,
      rankDevelopmentCost: item.rank_development_cost,
      rankLeadTime: item.rank_lead_time,
      totalScore: item.total_score,
      overallRank: item.overall_rank,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }));
  }

  private mapBaseData(data: any): PartWiseCostBaseDataDto {
    return {
      id: data.id,
      nominationId: data.nomination_id,
      bomItemId: data.bom_item_id,
      baseRawMaterialCost: data.base_raw_material_cost,
      baseProcessCost: data.base_process_cost,
      baseOverheadsProfit: data.base_overheads_profit,
      basePackingForwardingCost: data.base_packing_forwarding_cost,
      basePaymentTerms: data.base_payment_terms,
      baseNetPriceUnit: data.base_net_price_unit,
      baseDevelopmentCost: data.base_development_cost,
      baseFinancialRisk: data.base_financial_risk,
      baseCostCompetencyScore: data.base_cost_competency_score,
      baseLeadTimeDays: data.base_lead_time_days,
      costFactorWeight: data.cost_factor_weight,
      developmentCostFactorWeight: data.development_cost_factor_weight,
      leadTimeFactorWeight: data.lead_time_factor_weight,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}