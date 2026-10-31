import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@/common/database/database.service';
import type { DbClient } from '@/common/db/postgrest-client';
import { qualityDbError } from './quality-db-error';

/**
 * Project-level quality metrics, reports and dashboard. Every query runs as the signed-in user, so row-level security
 * (migration 936) limits it to the caller's organizations. A failed query is an error, never an empty or zero result.
 */
@Injectable()
export class QualityControlService {
  private readonly logger = new Logger(QualityControlService.name);

  constructor(private readonly database: DatabaseService) {}

  private db(): DbClient {
    return this.database.getUserClient();
  }

  async getQualityMetrics(
    projectId: string,
    userId: string,
    filters: {
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<any> {
    // Get all inspections for the project
    let query = this.db()
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
      this.logger.error(`Error fetching quality inspections for project ${projectId}: ${error.code} ${error.message}`);
      throw qualityDbError(error, 'retrieve quality metrics');
    }

    // Calculate metrics
    const totalInspections = inspections.length;
    const completedInspections = inspections.filter(i => i.status === 'completed' || i.status === 'approved').length;
    const passedInspections = inspections.filter(i => i.overall_result === 'pass').length;
    const failedInspections = inspections.filter(i => i.overall_result === 'fail').length;

    const passRate = totalInspections > 0 ? ((passedInspections / totalInspections) * 100).toFixed(1) : '0';
    const completionRate = totalInspections > 0 ? ((completedInspections / totalInspections) * 100).toFixed(1) : '0';

    // Non-conformances of this project's inspections (!inner drops those of other projects)
    const { data: nonConformances, error: nonConformancesError } = await this.db()
      .from('quality_non_conformances')
      .select('*, quality_inspections!inspection_id!inner(project_id)')
      .eq('quality_inspections.project_id', projectId);

    if (nonConformancesError) {
      this.logger.error(`Error fetching non-conformances for project ${projectId}: ${nonConformancesError.code} ${nonConformancesError.message}`);
      throw qualityDbError(nonConformancesError, 'retrieve non-conformances');
    }

    const totalNonConformances = nonConformances.length;
    const openNonConformances = nonConformances.filter(nc => nc.status !== 'closed').length;

    // Calculate average inspection time
    const inspectionsWithTime = inspections.filter(i =>
      i.actual_start_date && i.actual_end_date
    );

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
      inspectionsByStatus: this.groupByStatus(inspections),
      inspectionsByType: this.groupByType(inspections),
      monthlyTrends: await this.getMonthlyTrends(projectId, userId),
    };
  }

  async generateQualityReport(
    projectId: string,
    userId: string,
    reportType?: string,
  ): Promise<any> {
    if (!projectId) {
      throw new BadRequestException('Project ID is required to generate a quality report.');
    }

    const metrics = await this.getQualityMetrics(projectId, userId);

    // Get detailed inspection data
    const { data: inspections, error: inspectionsError } = await this.db()
      .from('quality_inspections')
      .select(`
        *,
        quality_inspection_results (*),
        projects (name),
        boms (name, version)
      `)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (inspectionsError) {
      this.logger.error(`Error fetching detailed inspection data for report: ${inspectionsError.code} ${inspectionsError.message}`);
      throw qualityDbError(inspectionsError, 'retrieve inspection data for the report');
    }

    // Get non-conformances with details
    const { data: nonConformances, error: nonConformancesError } = await this.db()
      .from('quality_non_conformances')
      .select(`
        *,
        quality_inspections!inspection_id!inner (name, type, project_id)
      `)
      .eq('quality_inspections.project_id', projectId);

    if (nonConformancesError) {
      this.logger.error(`Error fetching non-conformances for report: ${nonConformancesError.code} ${nonConformancesError.message}`);
      throw qualityDbError(nonConformancesError, 'retrieve non-conformances for the report');
    }

    return {
      reportType: reportType || 'comprehensive',
      generatedAt: new Date().toISOString(),
      projectId,
      summary: metrics,
      inspections,
      nonConformances,
      recommendations: this.generateRecommendations(metrics),
    };
  }

  async getQualityDashboard(
    projectId: string,
    userId: string,
  ): Promise<any> {
    if (!projectId) {
      throw new BadRequestException('Project ID is required to access the quality dashboard.');
    }

    const metrics = await this.getQualityMetrics(projectId, userId);

    // Get recent activities
    const { data: recentInspections, error: inspectionsError } = await this.db()
      .from('quality_inspections')
      .select('*')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (inspectionsError) {
      this.logger.error(`Error fetching recent inspections for dashboard: ${inspectionsError.code} ${inspectionsError.message}`);
      throw qualityDbError(inspectionsError, 'retrieve recent inspections');
    }

    const { data: recentNonConformances, error: nonConformancesError } = await this.db()
      .from('quality_non_conformances')
      .select(`
        *,
        quality_inspections!inspection_id!inner (name, project_id)
      `)
      .eq('quality_inspections.project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (nonConformancesError) {
      this.logger.error(`Error fetching recent non-conformances for dashboard: ${nonConformancesError.code} ${nonConformancesError.message}`);
      throw qualityDbError(nonConformancesError, 'retrieve recent non-conformances');
    }

    return {
      metrics,
      recentInspections,
      recentNonConformances,
      alerts: this.generateQualityAlerts(metrics),
    };
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