import type { UploadRow } from '../../infrastructure/repositories/electronics.repository';

export interface UploadedBytes {
  name: string;
  bytes: Buffer;
  /** Board-file role from the file-role table, when the file has one. */
  role: string | null;
}

// What a parser hands back: the candidate graph (unvalidated: the pipeline validates every graph against the contract,
// whoever produced it) and, when the parser has them, the extraction report (how each file was used, attached documents).
export interface ParsedGraph {
  graph: unknown;
  extraction?: { documents: Record<string, unknown>; filesReport: unknown[] };
}

// The first parser whose `accepts` returns true handles the upload.
export interface FeatureGraphParser {
  readonly id: string;
  accepts(upload: UploadRow, files: UploadedBytes[]): boolean;
  parse(upload: UploadRow, files: UploadedBytes[]): Promise<ParsedGraph>;
}

/** A parser refused the files for a reason the person can act on. Carries a stable code. */
export class ParseFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const FEATURE_GRAPH_PARSERS = Symbol('FEATURE_GRAPH_PARSERS');

// An upload that already is a feature graph (what an engineer or another tool supplies, or the harness form builds).
export class PrecomputedGraphParser implements FeatureGraphParser {
  readonly id = 'precomputed_feature_graph';

  accepts(_upload: UploadRow, files: UploadedBytes[]): boolean {
    return files.length === 1 && files[0].name.toLowerCase().endsWith('.json') && this.looksLikeGraph(files[0].bytes);
  }

  async parse(_upload: UploadRow, files: UploadedBytes[]): Promise<ParsedGraph> {
    return { graph: JSON.parse(files[0].bytes.toString('utf8')) };
  }

  private looksLikeGraph(bytes: Buffer): boolean {
    try {
      const doc: unknown = JSON.parse(bytes.toString('utf8'));
      return typeof doc === 'object' && doc !== null && 'contractVersion' in doc;
    } catch {
      return false;
    }
  }
}
