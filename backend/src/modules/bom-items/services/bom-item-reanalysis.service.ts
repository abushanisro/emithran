import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { MAX_CAD_FILE_BYTES } from '../../../common/upload-limits';
import { UpdateBOMItemDto } from '../dto/bom-items.dto';
import { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import { BOMItemsService } from '../bom-items.service';
import { AutoFillService } from './auto-fill.service';
import { FileStorageService } from './file-storage.service';
import { PlasticPullDirectionService } from './plastic-pull-direction.service';

/** Runs the CAD analysis (and the drawing's) on an item's stored files and stores the result on the item. Used by the analysis run (Apply Scenario) and by a changed pull direction. */
@Injectable()
export class BomItemReanalysisService {
  private readonly logger = new Logger(BomItemReanalysisService.name);

  constructor(
    private readonly bomItemsService: BOMItemsService,
    private readonly fileStorageService: FileStorageService,
    private readonly autoFillService: AutoFillService,
    private readonly pullDirections: PlasticPullDirectionService,
  ) {}

  async reanalyze(id: string, userId: string, token: string): Promise<BOMItemResponseDto> {
    const bomItem = await this.bomItemsService.findOne(id, userId, token);

    if (!bomItem.file3dPath && !bomItem.fileStepPath) {
      throw new BadRequestException('No 3D file found for this item — upload a STEP/STL file first');
    }

    // Prefer the original STEP (full OCC topology) over the browser-viewable STL
    const analysisPath = bomItem.fileStepPath ?? bomItem.file3dPath!;
    const signedUrl = await this.fileStorageService.getSignedUrl(analysisPath, 3600);

    let fileBuffer: Buffer;
    try {
      const response = await axios.get(signedUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: MAX_CAD_FILE_BYTES,
      });
      fileBuffer = Buffer.from(response.data);
    } catch (err) {
      this.logger.error(`[reanalyze] Failed to download file: ${err.message}`);
      throw new BadRequestException('Failed to download 3D file from storage');
    }

    const fileName = analysisPath.split('/').pop() ?? 'model.stp';
    // Re-analyse as the process the user chose (Create/Edit BOM Item's
    // Process field, persisted as scenario_overrides.processGroup). Without
    // this, every re-analysis re-ran the geometric classifier alone and
    // overwrote a Die Casting part's feature graph with machining features.
    const chosenProcessGroup = (bomItem.scenarioOverrides as Record<string, unknown> | undefined)?.['processGroup'];
    const familyHint = this.autoFillService.familyHintForProcessGroup(
      typeof chosenProcessGroup === 'string' ? chosenProcessGroup : undefined,
    );
    // The engineer's pull direction, when it applies to this file: the analysis is run along it (the engine chooses otherwise).
    const pullDirection = (await this.pullDirections.get(id, token)).axis;
    const result = await this.autoFillService.analyzeAndSuggest(fileBuffer, fileName, userId, token, undefined, true, familyHint, pullDirection ?? undefined);

    // analyzeAndSuggest throws (503 engine unreachable / 422 file rejected)
    // when the CAD engine did not analyse the file, so nothing below ever
    // overwrites a stored analysis with non-engine geometry.

    const geo = result.geometry;
    const sug = result.suggestions;

    // Carry the true-shape nest result across the re-analysis.
    //
    // analyzeAndSuggest builds featureGraph.summary as a fresh object, so this
    // cache used to be destroyed on every Reanalyze. An uncached resolve then
    // walked 5 candidate sheets sequentially against cad-engine's single-threaded
    // /nest (13-30s per sheet on real parts), and BOTH cost-summary and
    // route-comparison resolve it, concurrently, on the very next page load —
    // which is what made those two requests hang until the client gave up.
    //
    // Safe to carry because validity is no longer "the summary was not
    // rewritten": isTrueNestCostingCacheValid now also requires the cache's
    // inputFingerprint to match the geometry it is being reused for, so a
    // re-analysis that genuinely changed the flat pattern, thickness, density
    // or volume produces a different fingerprint and the stale entry is refused
    // rather than reused. A no-op re-analysis keeps its valid result.
    const priorNestCache = (bomItem.featureGraph as any)?.summary?.trueNestCostingCache;
    const featureGraph = result.featureGraph as any;
    const featureGraphWithNestCache = priorNestCache
      ? { ...featureGraph, summary: { ...(featureGraph?.summary ?? {}), trueNestCostingCache: priorNestCache } }
      : featureGraph;

    // Sync all geometry + classification fields, not just featureGraph.
    // material / materialGrade are intentionally excluded — those come from 2D drawing analysis and user input.
    const updateData: UpdateBOMItemDto = {
      featureGraph: featureGraphWithNestCache as object,
      holeCount: geo.holeCount,
      bendCount: geo.bendCount,
      cutLengthMm: geo.cutLengthMm,
      sheetThicknessMm: geo.sheetThicknessMm,
      pierceCount: geo.pierceCount,
      flatPatternAreaMm2: geo.flatPatternAreaMm2,
      ...(geo.weight > 0 && { weight: geo.weight }),
      ...(geo.volume > 0 && { volume: geo.volume }),
      ...(geo.surfaceArea > 0 && { surfaceArea: geo.surfaceArea }),
      ...(geo.boundingBox.length > 0 && { maxLength: geo.boundingBox.length }),
      ...(geo.boundingBox.width > 0 && { maxWidth: geo.boundingBox.width }),
      ...(geo.boundingBox.height > 0 && { maxHeight: geo.boundingBox.height }),
      ...(sug.familyClassification && { familyClassification: sug.familyClassification }),
      ...(sug.familyConfidence != null && { familyConfidence: sug.familyConfidence }),
    };

    return this.bomItemsService.update(id, updateData, userId, token);
  }

  /** Reads the title block, thread callouts and tolerances of the stored 2D drawing (a vector PDF) and stores them on the item. */
  async analyzeDrawing(id: string, userId: string, token: string): Promise<BOMItemResponseDto> {
    const bomItem = await this.bomItemsService.findOne(id, userId, token);
    if (!bomItem.file2dPath) {
      throw new BadRequestException('No 2D drawing found for this item — upload a PDF drawing first');
    }
    if (!bomItem.file2dPath.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('Drawing intelligence extraction requires a vector PDF (text extraction, not OCR) — this file is not a PDF');
    }
    const signedUrl = await this.fileStorageService.getSignedUrl(bomItem.file2dPath, 3600);
    let fileBuffer: Buffer;
    try {
      const response = await axios.get(signedUrl, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: MAX_CAD_FILE_BYTES });
      fileBuffer = Buffer.from(response.data);
    } catch (err: unknown) {
      this.logger.error(`[analyze-drawing] Failed to download file: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('Failed to download 2D file from storage');
    }
    const drawingResult = await this.autoFillService.analyzeDrawing(fileBuffer, bomItem.partNumber);
    return this.bomItemsService.update(id, { drawingIntelligence: drawingResult as unknown as Record<string, any> }, userId, token);
  }
}
