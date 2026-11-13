import { castingSourcePath } from '../../sand-casting/casting-source';
import { Injectable } from '@nestjs/common';

import { SandCastingService } from '../../sand-casting/sand-casting.service';
import { AutoFillService } from './auto-fill.service';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import {
  castingStatusOf,
  currentFeatureGraphVersion,
  deriveAnalysisStatus,
  type AnalysisStatus,
} from '../analysis-status';

/** Reads what deriveAnalysisStatus needs beyond the item itself (the casting-analysis rows) and answers for one item. */
@Injectable()
export class AnalysisStatusService {
  constructor(
    private readonly sandCasting: SandCastingService,
    private readonly autoFill: AutoFillService,
  ) {}

  async forItem(item: BOMItemResponseDto, token: string): Promise<AnalysisStatus> {
    const sourcePath = castingSourcePath({ file_3d_path: item.file3dPath, file_step_path: item.fileStepPath });
    const statuses = sourcePath ? await this.sandCasting.currentStatuses(item.id, sourcePath, token) : [];
    const group = (item.scenarioOverrides as Record<string, unknown> | null | undefined)?.['processGroup'];
    const chosenFamilyHint = this.autoFill.familyHintForProcessGroup(typeof group === 'string' ? group : undefined) ?? null;
    return deriveAnalysisStatus({ ...item, chosenFamilyHint }, castingStatusOf(statuses), currentFeatureGraphVersion());
  }
}
