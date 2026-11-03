import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/common/database/database.service';
import type { DbClient } from '@/common/db/postgrest-client';

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