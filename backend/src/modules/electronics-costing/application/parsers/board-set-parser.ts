import { Injectable } from '@nestjs/common';

import { ParseFailure, type FeatureGraphParser, type ParsedGraph, type UploadedBytes } from './feature-graph-parser';
import { EcadEngineClient, ExtractionRejected, ExtractionUnavailable } from '../../infrastructure/ecad/ecad-engine.client';

import type { UploadRow } from '../../infrastructure/repositories/electronics.repository';


// A board file set (Gerber layers, drill data, Pick Place, BOM workbook): measured by the ecad-engine service. This parser
// only hands the stored files to the engine and relays the answer; the Node side never reads Gerber itself. An engine that
// is down is an error the queue retries, never an empty or default graph.
@Injectable()
export class BoardSetParser implements FeatureGraphParser {
  readonly id = 'board_set_ecad_engine';

  constructor(private readonly engine: EcadEngineClient) {}

  // A board upload with at least one file that has a board-file role (a Gerber layer, drill data or a drill report).
  accepts(upload: UploadRow, files: UploadedBytes[]): boolean {
    return upload.kind === 'board' && files.some((f) => f.role !== null);
  }

  async parse(upload: UploadRow, files: UploadedBytes[]): Promise<ParsedGraph> {
    const supplied = ((upload.params)?.supplied ?? {});
    try {
      const result = await this.engine.extractBoard(files, supplied, upload.input_tier);
      return { graph: result.graph, extraction: { documents: result.documents, filesReport: result.filesReport } };
    } catch (error) {
      if (error instanceof ExtractionRejected) throw new ParseFailure(error.code, error.message);
      if (error instanceof ExtractionUnavailable) throw new ParseFailure('extraction_unavailable', error.message);
      throw error;
    }
  }
}
