// What an upload is, decided from its files: one upload field serves boards (a bare PCB or an assembled PCBA) and wire
// harnesses, so the person never picks a type. Whether a board is assembled is not decided here: it follows from the
// extracted placements.

export type DesignKind = 'board' | 'harness';
export type InputTier = 'A' | 'B' | 'C' | 'D';

export interface InferFile {
  name: string;
  /** Board-file role from the file-role table (a Gerber layer, drill data or a drill report). */
  role?: string | undefined;
  /** The parsed JSON document, when the upload is a single .json file. */
  json?: unknown;
}

export type InferredDesign = { ok: true; kind: DesignKind; tier: InputTier } | { ok: false; message: string };

const TIERS: readonly string[] = ['A', 'B', 'C', 'D'];

export function inferDesign(files: InferFile[]): InferredDesign {
  if (files.some((f) => f.role)) return { ok: true, kind: 'board', tier: 'B' };

  const doc = files.length === 1 ? files[0].json : undefined;
  if (typeof doc === 'object' && doc !== null && 'contractVersion' in doc) {
    const { kind, inputTier } = doc as { kind?: unknown; inputTier?: unknown };
    if (kind === 'board' || kind === 'harness') {
      return { ok: true, kind, tier: typeof inputTier === 'string' && TIERS.includes(inputTier) ? (inputTier as InputTier) : 'C' };
    }
  }

  return {
    ok: false,
    message: `Cannot tell whether ${files.map((f) => f.name).join(', ')} is a board or a wire harness. Add the board's Gerber and drill files, or a feature graph that states its kind.`,
  };
}
