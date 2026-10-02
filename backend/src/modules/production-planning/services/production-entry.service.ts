import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import {
  CreateProductionEntryDto,
  UpdateProductionEntryDto,
  ProductionEntryResponseDto,
  WeeklySummaryDto,
  ProductionEntriesQueryDto
} from '../dto/production-entry.dto';

@Injectable()
export class ProductionEntryService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async createProductionEntry(
    createDto: CreateProductionEntryDto,
    userId: string
  ): Promise<ProductionEntryResponseDto> {
    const supabase = this.supabaseService.getUserClient();

    // Check if entry already exists for this lot, process, date, and shift
    const { data: existing } = await supabase
      .from('production_entries')
      .select('id')
      .eq('lot_id', createDto.lotId)
      .eq('process_id', createDto.processId || null)
      .eq('entry_date', createDto.entryDate)
      .eq('shift', createDto.shift)
      .single();

    if (existing) {
      throw new ConflictException(
        `Production entry already exists for this lot, process, date, and shift`
      );
    }

    const { data, error } = await supabase
      .from('production_entries')
      .insert([
        {
          lot_id: createDto.lotId,
          process_id: createDto.processId || null,
          process_name: createDto.processName,
          entry_date: createDto.entryDate,
          shift: createDto.shift,
          target_quantity: createDto.targetQuantity,
          produced_quantity: createDto.producedQuantity,
          rejected_quantity: createDto.rejectedQuantity || 0,
          rework_quantity: createDto.reworkQuantity || 0,
          downtime_minutes: createDto.downtimeMinutes || 0,
          downtime_reason: createDto.downtimeReason || null,
          quality_issues: createDto.qualityIssues || null,
          operator_notes: createDto.operatorNotes || null,
          entered_by: userId
        }
      ])
      .select(`*`)
      .single();

    if (error) {
      throw new Error(`Failed to create production entry: ${error.message}`);
    }

    return this.mapToResponseDto(data);
  }

  async getProductionEntries(queryDto: ProductionEntriesQueryDto): Promise<ProductionEntryResponseDto[]> {
    const supabase = this.supabaseService.getUserClient();
    
    let query = supabase
      .from('production_entries')
      .select(`*`)
      .eq('lot_id', queryDto.lotId)
      .order('entry_date', { ascending: false })
      .order('shift', { ascending: true });

    // Apply filters
    if (queryDto.date) {
      query = query.eq('entry_date', queryDto.date);
    }

    if (queryDto.processId) {
      query = query.eq('process_id', queryDto.processId);
    }

    if (queryDto.shift) {
      query = query.eq('shift', queryDto.shift);
    }

    if (queryDto.startDate && queryDto.endDate) {
      query = query
        .gte('entry_date', queryDto.startDate)
        .lte('entry_date', queryDto.endDate);
    } else if (queryDto.startDate) {
      query = query.gte('entry_date', queryDto.startDate);
    } else if (queryDto.endDate) {
      query = query.lte('entry_date', queryDto.endDate);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch production entries: ${error.message}`);
    }

    return data.map(entry => this.mapToResponseDto(entry));
  }

  async getProductionEntryById(id: string): Promise<ProductionEntryResponseDto> {
    const supabase = this.supabaseService.getUserClient();
    
    const { data, error } = await supabase
      .from('production_entries')
      .select(`*`)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Production entry with ID ${id} not found`);
    }

    return this.mapToResponseDto(data);
  }

  async updateProductionEntry(
    id: string,
    updateDto: UpdateProductionEntryDto
  ): Promise<ProductionEntryResponseDto> {
    const supabase = this.supabaseService.getUserClient();

    // Check if entry exists
    const existing = await this.getProductionEntryById(id);

    // Check for conflicts if changing key fields
    if (updateDto.processId || updateDto.entryDate || updateDto.shift) {
      const { data: conflicting } = await supabase
        .from('production_entries')
        .select('id')
        .eq('lot_id', existing.lotId)
        .eq('process_id', updateDto.processId || existing.processId)
        .eq('entry_date', updateDto.entryDate || existing.entryDate)
        .eq('shift', updateDto.shift || existing.shift)
        .neq('id', id)
        .single();

      if (conflicting) {
        throw new ConflictException(
          `Another production entry already exists for this lot, process, date, and shift`
        );
      }
    }

    const updateData: any = {};
    
    // Only include fields that are provided
    if (updateDto.processId !== undefined) updateData.process_id = updateDto.processId;
    if (updateDto.processName !== undefined) updateData.process_name = updateDto.processName;
    if (updateDto.entryDate !== undefined) updateData.entry_date = updateDto.entryDate;
    if (updateDto.shift !== undefined) updateData.shift = updateDto.shift;
    if (updateDto.targetQuantity !== undefined) updateData.target_quantity = updateDto.targetQuantity;
    if (updateDto.producedQuantity !== undefined) updateData.produced_quantity = updateDto.producedQuantity;
    if (updateDto.rejectedQuantity !== undefined) updateData.rejected_quantity = updateDto.rejectedQuantity;
    if (updateDto.reworkQuantity !== undefined) updateData.rework_quantity = updateDto.reworkQuantity;
    if (updateDto.downtimeMinutes !== undefined) updateData.downtime_minutes = updateDto.downtimeMinutes;
    if (updateDto.downtimeReason !== undefined) updateData.downtime_reason = updateDto.downtimeReason;
    if (updateDto.qualityIssues !== undefined) updateData.quality_issues = updateDto.qualityIssues;
    if (updateDto.operatorNotes !== undefined) updateData.operator_notes = updateDto.operatorNotes;

    const { data, error } = await supabase
      .from('production_entries')
      .update(updateData)
      .eq('id', id)
      .select(`*`)
      .single();

    if (error) {
      throw new Error(`Failed to update production entry: ${error.message}`);
    }

    return this.mapToResponseDto(data);
  }

  async deleteProductionEntry(id: string): Promise<void> {
    const supabase = this.supabaseService.getUserClient();

    // Check if entry exists
    await this.getProductionEntryById(id);

    const { error } = await supabase
      .from('production_entries')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete production entry: ${error.message}`);
    }
  }

  async getWeeklySummary(lotId: string): Promise<WeeklySummaryDto[]> {
    const supabase = this.supabaseService.getUserClient();

    // Get production entries for the lot and group them manually
    const { data, error } = await supabase
      .from('production_entries')
      .select('*')
      .eq('lot_id', lotId)
      .order('entry_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch weekly summary: ${error.message}`);
    }

    // Group entries by week and calculate totals
    const weeklyData = new Map<string, any>();
    
    for (const entry of data || []) {
      const entryDate = new Date(entry.entry_date);
      const weekStart = new Date(entryDate);
      weekStart.setDate(entryDate.getDate() - entryDate.getDay()); // Start of week (Sunday)
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6); // End of week (Saturday)
      
      const weekKey = `${weekStart.getFullYear()}-W${Math.ceil(weekStart.getDate() / 7)}`;
      
      if (!weeklyData.has(weekKey)) {
        weeklyData.set(weekKey, {
          weekStart: weekStart.toISOString().split('T')[0],
          weekEnd: weekEnd.toISOString().split('T')[0],
          targetQuantity: 0,
          producedQuantity: 0,
          rejectedQuantity: 0,
          reworkQuantity: 0,
          totalDowntimeMinutes: 0
        });
      }
      
      const weekData = weeklyData.get(weekKey);
      weekData.targetQuantity += entry.target_quantity || 0;
      weekData.producedQuantity += entry.produced_quantity || 0;
      weekData.rejectedQuantity += entry.rejected_quantity || 0;
      weekData.reworkQuantity += entry.rework_quantity || 0;
      weekData.totalDowntimeMinutes += entry.downtime_minutes || 0;
    }

    return Array.from(weeklyData.entries()).map(([weekKey, weekData]) => ({
      week: `${weekKey} (${weekData.weekStart} - ${weekData.weekEnd})`,
      weekStart: weekData.weekStart,
      weekEnd: weekData.weekEnd,
      targetQuantity: weekData.targetQuantity,
      producedQuantity: weekData.producedQuantity,
      rejectedQuantity: weekData.rejectedQuantity,
      reworkQuantity: weekData.reworkQuantity,
      totalDowntimeMinutes: weekData.totalDowntimeMinutes,
      efficiency: weekData.targetQuantity > 0 ? Math.round((weekData.producedQuantity / weekData.targetQuantity) * 100) : 0
    }));
  }

  private mapToResponseDto(data: any): ProductionEntryResponseDto {
    return {
      id: data.id,
      lotId: data.lot_id,
      processId: data.process_id,
      processName: data.process_name,
      entryDate: data.entry_date,
      shift: data.shift,
      targetQuantity: data.target_quantity,
      producedQuantity: data.produced_quantity,
      rejectedQuantity: data.rejected_quantity,
      reworkQuantity: data.rework_quantity,
      downtimeMinutes: data.downtime_minutes,
      downtimeReason: data.downtime_reason,
      qualityIssues: data.quality_issues,
      operatorNotes: data.operator_notes,
      enteredBy: 'Unknown',
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }
}