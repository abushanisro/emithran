import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';

@Injectable()
export class QualityControlService {
  private readonly logger = new Logger(QualityControlService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getQualityMetrics(
    projectId: string,
    userId: string,
    filters: {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<any> {
    try {
      // Get all inspections for the project
      let query = this.supabase.client
        .from('quality_inspections')
        .select(`
          *,
          quality_inspection_results (*)
        `)
        .eq('project_id', projectId);

      if (filters.startDate) {
        query = query.gte('created_at', filters.startDate);
      }

      if (filters.endDate) {
        query = query.lte('created_at', filters.endDate);
      }

      const { data: inspections, error } = await query;

      if (error) {
        throw error;
      }

      // Calculate metrics
      const totalInspections = inspections?.length || 0;
      const completedInspections = inspections?.filter(i => i.status === 'completed' || i.status === 'approved').length || 0;
      const passedInspections = inspections?.filter(i => i.overall_result === 'pass').length || 0;
      const failedInspections = inspections?.filter(i => i.overall_result === 'fail').length || 0;
      
      const passRate = totalInspections > 0 ? ((passedInspections / totalInspections) * 100).toFixed(1) : '0';
      const completionRate = totalInspections > 0 ? ((completedInspections / totalInspections) * 100).toFixed(1) : '0';

      // Get non-conformances
      const { data: nonConformances } = await this.supabase.client
        .from('quality_non_conformances')
        .select('*, quality_inspections!inspection_id(project_id)')
        .eq('quality_inspections.project_id', projectId);

      const totalNonConformances = nonConformances?.length || 0;
      const openNonConformances = nonConformances?.filter(nc => nc.status !== 'closed').length || 0;

      // Calculate average inspection time
      const inspectionsWithTime = inspections?.filter(i => 
        i.actual_start_date && i.actual_end_date
      ) || [];
      
      let avgInspectionTime = 0;
      if (inspectionsWithTime.length > 0) {
        const totalTime = inspectionsWithTime.reduce((sum, inspection) => {
          const start = new Date(inspection.actual_start_date);
          const end = new Date(inspection.actual_end_date);
          return sum + (end.getTime() - start.getTime());
        }, 0);
        avgInspectionTime = totalTime / inspectionsWithTime.length / (1000 * 60 * 60); // Convert to hours
      }

      return {
        totalInspections,
        completedInspections,
        passedInspections,
        failedInspections,
        passRate: parseFloat(passRate),
        completionRate: parseFloat(completionRate),
        totalNonConformances,
        openNonConformances,
        avgInspectionTime: Math.round(avgInspectionTime * 10) / 10, // Round to 1 decimal
        inspectionsByStatus: this.groupByStatus(inspections || []),
        inspectionsByType: this.groupByType(inspections || []),
        monthlyTrends: await this.getMonthlyTrends(projectId, userId),
      };
    } catch (error) {
      this.logger.error('Error getting quality metrics:', error);
      throw error;
    }
  }

  async generateQualityReport(
    projectId: string,
    userId: string,
    reportType?: string,
  ): Promise<any> {
    try {
      const metrics = await this.getQualityMetrics(projectId, userId);
      
      // Get detailed inspection data
      const { data: inspections } = await this.supabase.client
        .from('quality_inspections')
        .select(`
          *,
          quality_inspection_results (*),
          projects (name),
          boms (name, version)
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      // Get non-conformances with details
      const { data: nonConformances } = await this.supabase.client
        .from('quality_non_conformances')
        .select(`
          *,
          quality_inspections!inspection_id (name, type)
        `)
        .eq('quality_inspections.project_id', projectId);

      return {
        reportType: reportType || 'comprehensive',
        generatedAt: new Date().toISOString(),
        projectId,
        summary: metrics,
        inspections: inspections || [],
        nonConformances: nonConformances || [],
        recommendations: this.generateRecommendations(metrics),
      };
    } catch (error) {
      this.logger.error('Error generating quality report:', error);
      throw error;
    }
  }

  async getQualityDashboard(
    projectId: string,
    userId: string,
  ): Promise<any> {
    try {
      const metrics = await this.getQualityMetrics(projectId, userId);
      
      // Get recent activities
      const { data: recentInspections } = await this.supabase.client
        .from('quality_inspections')
        .select('*')
        .eq('project_id', projectId)
        .order('updated_at', { ascending: false })
        .limit(10);

      const { data: recentNonConformances } = await this.supabase.client
        .from('quality_non_conformances')
        .select(`
          *,
          quality_inspections!inspection_id (name)
        `)
        .eq('quality_inspections.project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(5);

      return {
        metrics,
        recentInspections: recentInspections || [],
        recentNonConformances: recentNonConformances || [],
        alerts: this.generateQualityAlerts(metrics),
      };
    } catch (error) {
      this.logger.error('Error getting quality dashboard:', error);
      throw error;
    }
  }

  private groupByStatus(inspections: any[]): Record<string, number> {
    return inspections.reduce((acc, inspection) => {
      acc[inspection.status] = (acc[inspection.status] || 0) + 1;
      return acc;
    }, {});
  }

  private groupByType(inspections: any[]): Record<string, number> {
    return inspections.reduce((acc, inspection) => {
      acc[inspection.type] = (acc[inspection.type] || 0) + 1;
      return acc;
    }, {});
  }

  private async getMonthlyTrends(projectId: string, userId: string): Promise<any[]> {
    // This would typically involve more complex date aggregation
    // For now, return mock data structure
    const months = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: date.toISOString().slice(0, 7), // YYYY-MM format
        inspections: 0,
        passRate: 0,
        nonConformances: 0,
      });
    }

    return months;
  }

  private generateRecommendations(metrics: any): string[] {
    const recommendations: string[] = [];

    if (metrics.passRate < 85) {
      recommendations.push('Consider reviewing inspection criteria and training for inspectors');
      recommendations.push('Implement additional quality checkpoints in the production process');
    }

    if (metrics.avgInspectionTime > 8) {
      recommendations.push('Review inspection procedures to optimize time efficiency');
      recommendations.push('Consider automation tools for routine inspections');
    }

    if (metrics.openNonConformances > 5) {
      recommendations.push('Prioritize resolution of open non-conformances');
      recommendations.push('Implement preventive measures to reduce future non-conformances');
    }

    if (metrics.completionRate < 90) {
      recommendations.push('Improve inspection scheduling and resource allocation');
    }

    return recommendations;
  }

  private generateQualityAlerts(metrics: any): any[] {
    const alerts: any[] = [];

    if (metrics.passRate < 80) {
      alerts.push({
        type: 'error',
        title: 'Low Pass Rate',
        message: `Current pass rate is ${metrics.passRate}% which is below acceptable threshold`,
        priority: 'high',
      });
    }

    if (metrics.openNonConformances > 10) {
      alerts.push({
        type: 'warning',
        title: 'High Non-Conformances',
        message: `${metrics.openNonConformances} open non-conformances require attention`,
        priority: 'medium',
      });
    }

    if (metrics.completionRate < 85) {
      alerts.push({
        type: 'info',
        title: 'Inspection Backlog',
        message: 'Several inspections are pending completion',
        priority: 'low',
      });
    }

    return alerts;
  }
}