import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';

interface MaterialStatusUpdate {
  materialId: string;
  orderedQuantity?: number;
  receivedQuantity?: number;
  inspectedQuantity?: number;
  approvedQuantity?: number;
  rejectedQuantity?: number;
  consumedQuantity?: number;
  materialStatus?: string;
  batchNumber?: string;
  notes?: string;
}

interface MaterialTrackingHistoryEntry {
  id: string;
  action: string;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  batchNumber?: string;
  notes?: string;
  performedByName: string;
  performedAt: string;
}

interface ProductionAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  impact: string;
  suggestedAction: string;
  createdAt: string;
  source: string;
  relatedItems?: string[];
  affectedProcesses?: string[];
}

interface MonitoringMetrics {
  lotId: string;
  processId?: string;
  date: string;
  plannedOutput: number;
  actualOutput: number;
  acceptedOutput: number;
  rejectedOutput: number;
  reworkOutput: number;
  qualityRate: number;
  efficiencyPercentage: number;
  downtimeHours: number;
  downtimeReason?: string;
}

@Injectable()
export class ProductionMaterialTrackingService {
  constructor(private readonly supabaseService: SupabaseService) { }

  // ============================================================================
  // MATERIAL TRACKING METHODS
  // ============================================================================

  async initializeProductionLotMaterials(lotId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // Get production lot with selected BOM items
    const { data: lotData } = await supabase
      .from('production_lots')
      .select(`
        id,
        production_quantity,
        bom_id,
        boms!inner(user_id),
        selected_bom_items:production_lot_bom_items(
          bom_item_id,
          bom_item:bom_items(*)
        )
      `)
      .eq('id', lotId)
      .eq('boms.user_id', userId)
      .single();

    if (!lotData) {
      throw new NotFoundException('Production lot not found');
    }

    // Get selected BOM items or fall back to all BOM items if none selected
    let bomItems = [];
    
    if (lotData.selected_bom_items && lotData.selected_bom_items.length > 0) {
      // Use only the selected BOM items
      bomItems = lotData.selected_bom_items.map((item: any) => item.bom_item);
    } else {
      // No specific items selected, get all BOM items (fallback for legacy lots)
      const { data: allBomItems } = await supabase
        .from('bom_items')
        .select('*')
        .eq('bom_id', lotData.bom_id);
      bomItems = allBomItems || [];
    }

    if (!bomItems || bomItems.length === 0) {
      return [];
    }

    // Create production lot materials
    const materialInserts = bomItems.map(item => ({
      production_lot_id: lotId,
      bom_item_id: item.id,
      required_quantity: item.quantity * lotData.production_quantity,
      material_status: 'planning',
      criticality: this.determineCriticality(item),
      estimated_cost: (item.unit_cost || 0) * item.quantity * lotData.production_quantity,
      specifications: item.description || item.name,
      lead_time_days: 7, // Default lead time
    }));

    const { data: materials, error } = await supabase
      .from('production_lot_materials')
      .upsert(materialInserts, { onConflict: 'production_lot_id,bom_item_id' })
      .select(`
        *,
        bom_items!inner(
          id,
          name,
          part_number,
          description,
          quantity,
          unit,
          unit_cost
        )
      `);

    if (error) {
      throw new BadRequestException(`Failed to initialize materials: ${error.message}`);
    }

    return materials;
  }

  async getProductionLotMaterials(lotId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    // First check if there are specific BOM items selected for this lot
    const { data: selectedBomItems } = await supabase
      .from('production_lot_bom_items')
      .select('bom_item_id')
      .eq('production_lot_id', lotId);

    // Build the query
    let query = supabase
      .from('production_lot_materials')
      .select(`
        *,
        bom_items!inner(
          id,
          name,
          part_number,
          description,
          quantity,
          unit,
          material,
          unit_cost
        ),
        vendors(
          id,
          name,
          company_email
        )
      `)
      .eq('production_lot_id', lotId);

    // If there are specific BOM items selected, filter by them
    if (selectedBomItems && selectedBomItems.length > 0) {
      const selectedBomItemIds = selectedBomItems.map(item => item.bom_item_id);
      query = query.in('bom_item_id', selectedBomItemIds);
    }

    const { data: materials, error } = await query.order('created_at');

    if (error) {
      throw new BadRequestException(`Failed to fetch materials: ${error.message}`);
    }

    // Get tracking history for each material
    const materialsWithHistory = await Promise.all(
      materials.map(async (material) => {
        const { data: history } = await supabase
          .from('material_tracking_history')
          .select('*')
          .eq('production_lot_material_id', material.id)
          .order('performed_at', { ascending: false })
          .limit(10);

        return {
          ...material,
          trackingHistory: history || [],
          processImpact: await this.getAffectedProcesses(lotId, material.bom_item_id),
          alerts: await this.getMaterialAlerts(material.id),
        };
      })
    );

    return materialsWithHistory;
  }

  async updateMaterialStatus(
    materialId: string,
    updates: MaterialStatusUpdate,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify user has access
    const { data: material } = await supabase
      .from('production_lot_materials')
      .select(`
        *,
        production_lots!inner(
          boms!inner(user_id)
        )
      `)
      .eq('id', materialId)
      .eq('production_lots.boms.user_id', userId)
      .single();

    if (!material) {
      throw new NotFoundException('Material not found');
    }

    const { data: updatedMaterial, error } = await supabase
      .from('production_lot_materials')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', materialId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to update material: ${error.message}`);
    }

    return updatedMaterial;
  }

  async getMaterialTrackingHistory(materialId: string, userId: string): Promise<MaterialTrackingHistoryEntry[]> {
    const supabase = this.supabaseService.getClient();

    const { data: history, error } = await supabase
      .from('material_tracking_history')
      .select('*')
      .eq('production_lot_material_id', materialId)
      .order('performed_at', { ascending: false });

    if (error) {
      throw new BadRequestException(`Failed to fetch tracking history: ${error.message}`);
    }

    return history || [];
  }

  // ============================================================================
  // MONITORING DASHBOARD METHODS
  // ============================================================================

  async getProductionMonitoringData(lotId: string, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Verify access
    await this.verifyLotAccess(lotId, userId);

    // Get production processes with progress
    const { data: processes } = await supabase
      .from('production_processes')
      .select(`
        *,
        process_subtasks(
          id,
          status,
          task_name,
          estimated_duration_hours,
          actual_duration_hours
        )
      `)
      .eq('production_lot_id', lotId)
      .order('process_sequence');

    // Calculate material readiness for each process
    const processesWithMaterialReadiness = await Promise.all(
      (processes || []).map(async (process) => {
        const materialReadiness = await this.calculateProcessMaterialReadiness(lotId, process.id);
        const requiredMaterials = await this.getProcessRequiredMaterials(lotId, process.id);

        return {
          ...process,
          materialReadiness,
          requiredMaterials,
          bottlenecks: await this.getProcessBottlenecks(process.id),
        };
      })
    );

    // Get overall metrics
    const overallMetrics = await this.calculateOverallMetrics(lotId);

    // Get recent alerts
    const alerts = await this.getProductionAlerts(lotId, userId);

    return {
      processes: processesWithMaterialReadiness,
      overallMetrics,
      alerts,
      materialSummary: await this.getMaterialSummary(lotId),
    };
  }

  async getIntegratedDashboardData(lotId: string, userId: string): Promise<any> {
    // Get all data in parallel for better performance
    const [
      lotData,
      materials,
      processes,
      alerts,
      metrics
    ] = await Promise.all([
      this.getProductionLotDetails(lotId, userId),
      this.getProductionLotMaterials(lotId, userId),
      this.getProductionProcesses(lotId, userId),
      this.getProductionAlerts(lotId, userId),
      this.getProductionMetrics(lotId, userId)
    ]);

    // Initialize materials if they don't exist
    let finalMaterials = materials;
    if (!materials || materials.length === 0) {
      try {
        finalMaterials = await this.initializeProductionLotMaterials(lotId, userId);
      } catch (error) {
        // Could not initialize materials - using empty array
        finalMaterials = [];
      }
    }

    // Calculate integrated metrics with safe defaults
    const materialReadiness = this.calculateOverallMaterialReadiness(finalMaterials);
    const productionProgress = this.calculateProductionProgress(processes);
    const criticalAlerts = alerts.filter(alert => alert.severity === 'critical');
    const integratedAlerts = this.createIntegratedAlerts(finalMaterials, processes, alerts);

    return {
      success: true,
      data: {
        lot: lotData,
        materials: finalMaterials,
        processes,
        alerts: integratedAlerts,
        metrics: {
          productionProgress: isNaN(productionProgress) ? 0 : productionProgress,
          materialReadiness: isNaN(materialReadiness) ? 0 : materialReadiness,
          criticalAlerts: criticalAlerts.length,
          totalAlerts: alerts.length,
          totalMaterials: finalMaterials.length,
          materialsApproved: finalMaterials.filter(m => m.material_status === 'approved').length,
          blockedProcesses: processes.filter(p => p.status === 'blocked').length || 0,
          totalCost: finalMaterials.reduce((sum, m) => sum + (m.estimated_cost || 0), 0),
          ...metrics
        }
      }
    };
  }

  async recordProductionMetrics(
    lotId: string,
    metricsData: MonitoringMetrics,
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    await this.verifyLotAccess(lotId, userId);

    const { data: metrics, error } = await supabase
      .from('production_monitoring_metrics')
      .upsert({
        production_lot_id: lotId,
        production_process_id: metricsData.processId,
        metric_date: metricsData.date,
        metric_type: 'production_output',
        planned_output: metricsData.plannedOutput,
        actual_output: metricsData.actualOutput,
        accepted_output: metricsData.acceptedOutput,
        rejected_output: metricsData.rejectedOutput,
        rework_output: metricsData.reworkOutput,
        quality_rate: metricsData.qualityRate,
        efficiency_percentage: metricsData.efficiencyPercentage,
        downtime_hours: metricsData.downtimeHours,
        downtime_reason: metricsData.downtimeReason,
      }, {
        onConflict: 'production_lot_id,production_process_id,metric_date,metric_type'
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to record metrics: ${error.message}`);
    }

    return metrics;
  }

  // ============================================================================
  // ALERTS MANAGEMENT
  // ============================================================================

  async getProductionAlerts(lotId: string, userId: string): Promise<ProductionAlert[]> {
    const supabase = this.supabaseService.getClient();

    await this.verifyLotAccess(lotId, userId);

    const { data: alerts, error } = await supabase
      .from('production_material_alerts')
      .select('*')
      .eq('production_lot_id', lotId)
      .eq('status', 'active')
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      throw new BadRequestException(`Failed to fetch alerts: ${error.message}`);
    }

    return alerts || [];
  }

  async createManualAlert(
    lotId: string,
    alertData: {
      type: string;
      severity: string;
      title: string;
      message: string;
      materialId?: string;
      processId?: string;
    },
    userId: string,
  ): Promise<any> {
    const supabase = this.supabaseService.getClient();

    await this.verifyLotAccess(lotId, userId);

    const { data: alert, error } = await supabase
      .from('production_material_alerts')
      .insert({
        production_lot_id: lotId,
        production_lot_material_id: alertData.materialId,
        production_process_id: alertData.processId,
        alert_type: alertData.type,
        severity: alertData.severity,
        source: 'manual',
        title: alertData.title,
        message: alertData.message,
        status: 'active',
      })
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to create alert: ${error.message}`);
    }

    return alert;
  }

  async resolveAlert(alertId: string, resolutionNotes: string, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    const { data: alert, error } = await supabase
      .from('production_material_alerts')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: userId,
        resolution_notes: resolutionNotes,
      })
      .eq('id', alertId)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException(`Failed to resolve alert: ${error.message}`);
    }

    return alert;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async verifyLotAccess(lotId: string, userId: string): Promise<void> {
    // Skip access verification in development mode for faster iteration
    if (process.env.DISABLE_AUTH === 'true') {
      return;
    }

    const supabase = this.supabaseService.getClient();

    const { data } = await supabase
      .from('production_lots')
      .select('boms!inner(user_id)')
      .eq('id', lotId)
      .eq('boms.user_id', userId)
      .single();

    if (!data) {
      throw new NotFoundException('Production lot not found or access denied');
    }
  }

  private determineCriticality(bomItem: any): string {
    // Simple logic - can be enhanced with business rules
    if (bomItem.unit_cost > 1000) return 'critical';
    if (bomItem.unit_cost > 500) return 'high';
    if (bomItem.unit_cost > 100) return 'medium';
    return 'low';
  }

  private async calculateProcessMaterialReadiness(lotId: string, processId: string): Promise<number> {
    const supabase = this.supabaseService.getClient();

    // Get materials required for this process (simplified - all materials for now)
    const { data: materials } = await supabase
      .from('production_lot_materials')
      .select('required_quantity, approved_quantity')
      .eq('production_lot_id', lotId);

    if (!materials || materials.length === 0) return 100;

    const totalRequired = materials.reduce((sum, m) => sum + m.required_quantity, 0);
    const totalApproved = materials.reduce((sum, m) => sum + m.approved_quantity, 0);

    return totalRequired > 0 ? Math.round((totalApproved / totalRequired) * 100) : 100;
  }

  private async getProcessRequiredMaterials(lotId: string, processId: string): Promise<string[]> {
    const supabase = this.supabaseService.getClient();

    // Simplified - return all material part numbers for this lot
    const { data: materials } = await supabase
      .from('production_lot_materials')
      .select('bom_items!inner(part_number)')
      .eq('production_lot_id', lotId);

    return materials?.map(m => {
      const bomItem = Array.isArray(m.bom_items) ? m.bom_items[0] : m.bom_items;
      return bomItem?.part_number;
    }).filter(Boolean) || [];
  }

  private async getProcessBottlenecks(processId: string): Promise<string[]> {
    // Simplified bottleneck detection
    return [];
  }

  private async calculateOverallMetrics(lotId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    // Get recent production metrics
    const { data: metrics } = await supabase
      .from('production_monitoring_metrics')
      .select('*')
      .eq('production_lot_id', lotId)
      .order('metric_date', { ascending: false })
      .limit(10);

    return {
      totalProduced: metrics?.reduce((sum, m) => sum + m.actual_output, 0) || 0,
      totalAccepted: metrics?.reduce((sum, m) => sum + m.accepted_output, 0) || 0,
      totalRejected: metrics?.reduce((sum, m) => sum + m.rejected_output, 0) || 0,
      overallYieldRate: this.calculateYieldRate(metrics || []),
      averageEfficiency: this.calculateAverageEfficiency(metrics || []),
    };
  }

  private calculateYieldRate(metrics: any[]): number {
    if (!metrics || metrics.length === 0) return 0;
    const totalProduced = metrics.reduce((sum, m) => sum + m.actual_output, 0);
    const totalAccepted = metrics.reduce((sum, m) => sum + m.accepted_output, 0);
    return totalProduced > 0 ? Math.round((totalAccepted / totalProduced) * 100) : 0;
  }

  private calculateAverageEfficiency(metrics: any[]): number {
    if (!metrics || metrics.length === 0) return 0;
    const totalEfficiency = metrics.reduce((sum, m) => sum + m.efficiency_percentage, 0);
    return Math.round(totalEfficiency / metrics.length);
  }

  private async getMaterialSummary(lotId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    const { data: materials } = await supabase
      .from('production_lot_materials')
      .select('material_status, criticality, required_quantity, approved_quantity')
      .eq('production_lot_id', lotId);

    const summary = {
      total: materials?.length || 0,
      critical: materials?.filter(m => m.criticality === 'critical').length || 0,
      approved: materials?.filter(m => m.material_status === 'approved').length || 0,
      inUse: materials?.filter(m => m.material_status === 'in_use').length || 0,
      totalCost: materials?.reduce((sum, m) => sum + (m.required_quantity * 10), 0) || 0, // Simplified
    };

    return summary;
  }

  private async getAffectedProcesses(lotId: string, bomItemId: string): Promise<string[]> {
    const supabase = this.supabaseService.getClient();
    
    // Get processes for this lot
    const { data: processes } = await supabase
      .from('production_processes')
      .select('process_name')
      .eq('production_lot_id', lotId);
    
    // Return process names (in real implementation, you'd map materials to specific processes)
    return processes?.map(p => p.process_name) || ['Material Preparation', 'Assembly', 'Quality Control'];
  }

  private async getMaterialAlerts(materialId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    const { data: alerts } = await supabase
      .from('production_material_alerts')
      .select('*')
      .eq('production_lot_material_id', materialId)
      .eq('status', 'active');

    return alerts || [];
  }

  private async getProductionLotDetails(lotId: string, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    const { data: lot } = await supabase
      .from('production_lots')
      .select(`
        *,
        boms!inner(
          id,
          name,
          version,
          user_id
        )
      `)
      .eq('id', lotId)
      .eq('boms.user_id', userId)
      .single();

    return lot;
  }

  private async getProductionProcesses(lotId: string, userId: string): Promise<any[]> {
    const supabase = this.supabaseService.getClient();

    await this.verifyLotAccess(lotId, userId);

    const { data: processes } = await supabase
      .from('production_processes')
      .select('*')
      .eq('production_lot_id', lotId)
      .order('process_sequence');

    return processes || [];
  }

  private async getProductionMetrics(lotId: string, userId: string): Promise<any> {
    const supabase = this.supabaseService.getClient();

    await this.verifyLotAccess(lotId, userId);

    const { data: metrics } = await supabase
      .from('production_monitoring_metrics')
      .select('*')
      .eq('production_lot_id', lotId)
      .order('metric_date', { ascending: false })
      .limit(30);

    return this.processMetricsData(metrics || []);
  }

  private calculateOverallMaterialReadiness(materials: any[]): number {
    if (!materials || materials.length === 0) return 0;

    const totalRequired = materials.reduce((sum, m) => sum + (m.required_quantity || 0), 0);
    const totalApproved = materials.reduce((sum, m) => sum + (m.approved_quantity || 0), 0);

    return totalRequired > 0 ? Math.round((totalApproved / totalRequired) * 100) : 0;
  }

  private calculateProductionProgress(processes: any[]): number {
    if (!processes || processes.length === 0) return 0;

    const totalProgress = processes.reduce((sum, p) => sum + (p.completion_percentage || 0), 0);
    return processes.length > 0 ? Math.round(totalProgress / processes.length) : 0;
  }

  private createIntegratedAlerts(materials: any[], processes: any[], alerts: any[]): ProductionAlert[] {
    const integratedAlerts: ProductionAlert[] = [...alerts];

    // Add material shortage alerts
    materials.forEach(material => {
      if (material.approved_quantity < material.required_quantity * 0.8) {
        integratedAlerts.push({
          id: `material-${material.id}`,
          type: 'MATERIAL',
          severity: material.approved_quantity < material.required_quantity * 0.5 ? 'CRITICAL' : 'HIGH',
          title: `Material Shortage: ${material.bom_items.name}`,
          message: `Only ${material.approved_quantity} of ${material.required_quantity} required units available`,
          impact: 'Production may be delayed if not addressed',
          suggestedAction: 'Order additional material or adjust production schedule',
          createdAt: new Date().toISOString(),
          source: 'BOM',
          relatedItems: [material.bom_items.part_number],
          affectedProcesses: material.processImpact || [],
        });
      }
    });

    return integratedAlerts.sort((a, b) => {
      const severityOrder: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
    });
  }

  private processMetricsData(metrics: any[]): any {
    return {
      totalEntries: metrics.length,
      averageEfficiency: this.calculateAverageEfficiency(metrics),
      qualityRate: this.calculateYieldRate(metrics),
      totalDowntime: metrics.reduce((sum, m) => sum + (m.downtime_hours || 0), 0),
    };
  }
}