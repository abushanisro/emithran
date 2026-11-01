import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service';

/**
 * Read-only view of should-cost calibration runs. Running a calibration and recording actuals are operator work
 * (scripts/should-cost-calibrate.ts, src/modules/should-cost/calibration.ts), never an HTTP request: a run changes the global
 * BENCHMARK machine-hour rates every organization uses.
 */
@Injectable()
export class CalibrationService {
  constructor(private readonly databaseService: DatabaseService) {}

  /** Return the last N calibration runs, most recent first. */
  async getHistory(limit = 50): Promise<any[]> {
    const { data, error } = await this.databaseService
      .getPrivilegedClient('reference-data: global should-cost calibration history (no tenant data), written only by the operator script')
      .from('rate_calibration_history')
      .select('*')
      .order('calibrated_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`History fetch failed: ${error.message}`);
    return data ?? [];
  }
}
