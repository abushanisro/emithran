import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../../../common/database/database.service';
import { MAX_CAD_FILE_BYTES } from '../../../common/upload-limits';
import { FileStorageService } from './file-storage.service';

/** The staged 2-Model Machining data (memory/"2 Mold Molding", migration 823). */
export const TWO_MODEL_SOURCE_VERSION = '2026-2MoldMolding';
/** The cad-engine's default when the variable is not staged (two_model/compare.py DEFAULT_SENSITIVITY). */
const DEFAULT_SENSITIVITY = 82;

/** The cad-engine's comparison of a finished part with its source component (two_model/compare.py). */
export interface TwoModelComparisonResult {
  comparison_version: string;
  aligned: boolean;
  misalignment: string | null;
  target_volume_mm3: number;
  source_volume_mm3: number;
  outside_fraction?: number;
  allowed_outside_fraction?: number;
  as_supplied_face_ids?: number[];
  machined_face_ids?: number[];
  removed_volume_mm3?: number;
  measurements?: Record<string, unknown>;
}

/** bom_items.two_model_comparison (migration 1068): the result and the two STEP files it was made from. */
export interface StoredTwoModelComparison {
  sourceItemId: string;
  targetFile: string;
  sourceFile: string;
  comparedAt: string;
  result: TwoModelComparisonResult;
}

interface ItemFiles { id: string; name: string; file_step_path: string | null; source_item_id: string | null; two_model_comparison: StoredTwoModelComparison | null }

/**
 * The stored comparison when it is the one for the part's current link and files, else why not: the cost reads only a comparison made
 * from the very files the part and its source now have.
 */
export function currentComparison(
  item: { sourceItemId: string | null; fileStepPath: string | null; twoModelComparison: StoredTwoModelComparison | null },
  sourceFileStepPath: string | null,
): { comparison: StoredTwoModelComparison } | { missing: string } {
  if (!item.sourceItemId) return { missing: 'no source component: pick the casting or forging this part is machined from in Cost Guide > 2-Model Machining > Source (an item of this BOM with a STEP model)' };
  if (!item.fileStepPath) return { missing: 'the part has no STEP model to compare with its source' };
  if (!sourceFileStepPath) return { missing: 'the source component has no STEP model' };
  const c = item.twoModelComparison;
  if (!c || c.sourceItemId !== item.sourceItemId || c.targetFile !== item.fileStepPath || c.sourceFile !== sourceFileStepPath) {
    return { missing: 'the two models have not been compared since the link or a file changed: press Refresh analysis' };
  }
  return { comparison: c };
}

/**
 * Compares a 2-Model Machining part's STEP model with its source component's (cad-engine POST /analyze/two-model) and stores the result on
 * the part (bom_items.two_model_comparison), keyed by the two files. Run when the source is linked and when the part is re-analysed.
 */
@Injectable()
export class TwoModelService {
  private readonly logger = new Logger(TwoModelService.name);
  private readonly cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5055';
  private readonly cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';

  constructor(
    private readonly database: DatabaseService,
    private readonly files: FileStorageService,
  ) {}

  /** cadModelMisalignmentSensitivity (0-100) of the staged data; the engine's default when it is not staged. */
  private async sensitivity(accessToken: string): Promise<number> {
    // machining_reference_data is readable by every signed-in user (its public-read policy): the caller's own client.
    const { data } = await this.database.getClient(accessToken)
      .from('machining_reference_data').select('value')
      .eq('category', 'variable').eq('source_version', TWO_MODEL_SOURCE_VERSION).eq('key', 'cadModelMisalignmentSensitivity').limit(1);
    const v = Number((data as Array<{ value: unknown }> | null)?.[0]?.value);
    return Number.isFinite(v) ? v : DEFAULT_SENSITIVITY;
  }

  private async download(path: string): Promise<Buffer> {
    const url = await this.files.getSignedUrl(path, 3600);
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: MAX_CAD_FILE_BYTES });
    return Buffer.from(response.data);
  }

  /**
   * Compares the part with its linked source and stores the result; clears a stored one when the part has no source. Returns the stored
   * comparison, or why none could be made (a part or source without a STEP model, the engine unreachable). Never throws: the link and the
   * analysis stand without it, and the cost names what is missing.
   */
  async compare(itemId: string, accessToken: string): Promise<{ comparison: StoredTwoModelComparison | null; error: string | null }> {
    const client = this.database.getClient(accessToken);
    const { data: part, error: readError } = await client.from('bom_items')
      .select('id, name, file_step_path, source_item_id, two_model_comparison').eq('id', itemId).maybeSingle();
    if (readError || !part) return { comparison: null, error: readError?.message ?? 'the part was not found' };
    const item = part as ItemFiles;
    if (!item.source_item_id) {
      if (item.two_model_comparison) await client.from('bom_items').update({ two_model_comparison: null }).eq('id', itemId);
      return { comparison: null, error: null };
    }
    const { data: src } = await client.from('bom_items').select('id, name, file_step_path').eq('id', item.source_item_id).maybeSingle();
    const source = src as Pick<ItemFiles, 'id' | 'name' | 'file_step_path'> | null;
    if (!item.file_step_path || !source?.file_step_path) return { comparison: null, error: 'a STEP model is missing: the part and its source each need one' };
    try {
      const [target, sourceFile, sensitivity] = await Promise.all([this.download(item.file_step_path), this.download(source.file_step_path), this.sensitivity(accessToken)]);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FormData = require('form-data');
      const form = new FormData();
      form.append('target', target, { filename: 'target.step', contentType: 'application/step' });
      form.append('source', sourceFile, { filename: 'source.step', contentType: 'application/step' });
      form.append('sensitivity', String(sensitivity));
      const response = await axios.post(`${this.cadEngineUrl}/analyze/two-model`, form, {
        headers: { ...form.getHeaders(), ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }) },
        timeout: 180000, maxBodyLength: Infinity,
      });
      const stored: StoredTwoModelComparison = {
        sourceItemId: source.id, targetFile: item.file_step_path, sourceFile: source.file_step_path,
        comparedAt: new Date().toISOString(), result: response.data as TwoModelComparisonResult,
      };
      const { error: writeError } = await client.from('bom_items').update({ two_model_comparison: stored }).eq('id', itemId);
      if (writeError) return { comparison: null, error: `the comparison could not be stored: ${writeError.message}` };
      return { comparison: stored, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[two-model] ${itemId} vs ${source.id}: ${message}`);
      return { comparison: null, error: `the two models could not be compared: ${message}` };
    }
  }
}
