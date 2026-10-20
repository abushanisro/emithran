/**
 * What to tell a person when the BOM item form refuses files they dropped. The form takes STEP, DXF and DWG parts;
 * circuit board files (Gerber layers, drill data, Pick Place) belong in the Electronics module of a project. The board file types come
 * from the platform file-role table, passed in; none are listed here.
 */

export interface RejectedFile { name: string; tooLarge: boolean }

export interface RejectionMessage {
  title: string;
  description: string;
  /** True when the files are circuit board files: offer the project Electronics module. */
  boardFiles: boolean;
}

const extensionOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

export function describeRejection(rejected: RejectedFile[], boardExtensions: ReadonlySet<string>, maxMb: number): RejectionMessage {
  const names = rejected.map((r) => r.name).join(', ');
  if (rejected.some((r) => boardExtensions.has(extensionOf(r.name)))) {
    return {
      title: 'These are circuit board files',
      description: `${names}: this form takes STEP, DXF and DWG parts. Upload board files in the Electronics module of the project.`,
      boardFiles: true,
    };
  }
  const tooLarge = rejected.some((r) => r.tooLarge);
  return {
    title: tooLarge ? 'File too large' : 'File type not supported',
    description: `${names}: ${tooLarge ? `the limit is ${maxMb} MB per file.` : 'this form takes STEP (.step, .stp) for 3D parts and DXF or DWG for drawings.'}`,
    boardFiles: false,
  };
}
