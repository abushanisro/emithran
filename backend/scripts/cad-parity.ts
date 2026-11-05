// Parity harness helper (geometry-worker/tests/real/run.py). Three jobs, each printing one JSON document on stdout:
//
//   ts-node -r tsconfig-paths/register scripts/cad-parity.ts archive <file.zip> <out-dir>
//       The backend's extractor on its own (no geometry): entries (bytes written to <out-dir>/<index>) and skipped files.
//   ts-node ... cad-parity.ts python-path <file.zip> <engine-url> <out-dir>
//       The backend's real CadUploadRunner, CAD_CORE=python, against a running cad-engine: unzip -> /analyze/assembly -> /assembly/parts ->
//       the BOM items it would create. The database, the object store and the BOM service are recording fakes; nothing is written anywhere.
//   ts-node ... cad-parity.ts rust-path <file.zip> <analysed.json> <parts-dir> <out-dir>
//       The same runner with CAD_CORE=rust, materializing what the Rust runner left (its report and one STEP file per part).
//
// Customer files are read from the paths given; nothing is committed.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { expandArchive } from '../src/common/archive/expand-archive';
import { CadUploadRunner } from '../src/modules/cad-uploads/cad-upload-runner';
import type { CadUploadRow } from '../src/modules/cad-uploads/cad-upload.types';

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const [mode, zipPath, ...rest] = process.argv.slice(2);

function archive(outDir: string): void {
  const bytes = fs.readFileSync(zipPath!);
  const out = expandArchive(path.basename(zipPath!), bytes, { maxEntries: 10_000, maxEntryBytes: 50 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024 });
  if (!out.ok) return void console.log(JSON.stringify({ error: { code: out.code, message: out.message } }));
  fs.mkdirSync(outDir, { recursive: true });
  const entries = out.entries.map((e, index) => {
    fs.writeFileSync(path.join(outDir, String(index)), e.bytes);
    return { index, name: e.name, path: e.path, size: e.bytes.length };
  });
  console.log(JSON.stringify({ root: out.root, entries, skipped: out.skipped }));
}

const row = (over: Partial<CadUploadRow>): CadUploadRow => ({
  id: 'parity-upload-1', organization_id: 'org', created_by: 'user', bom_id: 'bom', project_id: 'proj', file_name: path.basename(zipPath!), sha256: 'h',
  size_bytes: 0, storage_path: 'cad-uploads/org/h.zip', status: 'running', attempts: 1, materialize_attempts: 0, error_code: null, error_detail: null,
  result: null, created_item_ids: [], created_at: '', started_at: '', finished_at: null, source_deleted_at: null, ...over,
});

/** The runner with recording fakes; resolves with what it did. */
async function runRunner(claimed: CadUploadRow, objects: { get: (bucket: string, p: string) => Promise<Buffer | null>; remove?: (bucket: string, paths: string[]) => Promise<void> }, outDir: string) {
  const updates: Record<string, unknown>[] = [];
  let claims = 0;
  const admin = {
    rpc: async () => ({ data: claims++ === 0 ? [claimed] : [], error: null }),
    from: () => ({
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
      select: () => { const q: any = { eq: () => q, is: () => q, lt: () => q, in: () => q, limit: async () => ({ data: [], error: null }), then: undefined }; return q; },
    }),
  };
  const items: Record<string, unknown>[] = [];
  const stored: { item: string; name: string; size: number; sha256: string }[] = [];
  let next = 0;
  const bomItems = {
    createForUpload: async (dto: Record<string, unknown>) => { const id = `item-${++next}`; items.push({ id, ...dto }); return { id }; },
    deleteItemsForUpload: async () => [] as string[],
    setFile3dPathForUpload: async () => undefined,
  };
  const files = {
    uploadFile: async (f: { originalname: string; buffer: Buffer }, _t: string, _u: string, _p: string, itemId: string) => {
      stored.push({ item: itemId, name: f.originalname, size: f.buffer.length, sha256: sha(f.buffer) });
      return { storagePath: `fake/${stored.length}` };
    },
    removeUnreferencedFiles: async () => 0,
  };
  const audit = { recordBestEffort: async () => undefined };
  const store = { remove: async () => undefined, ...objects };
  const runner = new CadUploadRunner({ getPrivilegedClient: () => admin } as never, bomItems as never, files as never, audit as never, store as never);
  await runner.tick();
  const status = [...updates].reverse().find((u) => 'status' in u) ?? null;
  const out = {
    status: status ? (status as { status: string }).status : null,
    error: status ? { code: (status as any).error_code ?? null, detail: (status as any).error_detail ?? null } : null,
    result: status && (status as any).result ? (status as any).result : null,
    items: items.map(({ id, parentItemId, name, itemType, quantity, partNumber, volume, surfaceArea, maxLength, maxWidth, maxHeight }) => ({ id, parentItemId, name, itemType, quantity, partNumber, volume, surfaceArea, maxLength, maxWidth, maxHeight })),
    storedFiles: stored,
  };
  fs.mkdirSync(outDir, { recursive: true });
  console.log(JSON.stringify(out));
}

async function main(): Promise<void> {
  if (mode === 'archive') return archive(rest[0]!);
  const bytes = fs.readFileSync(zipPath!);
  if (mode === 'python-path') {
    process.env.CAD_CORE = 'python';
    process.env.CAD_ENGINE_URL = rest[0]!;
    return runRunner(row({ size_bytes: bytes.length }), { get: async () => bytes }, rest[1]!);
  }
  if (mode === 'rust-path') {
    process.env.CAD_CORE = 'rust';
    const [analysedPath, partsDir, outDir] = rest;
    const analysed = JSON.parse(fs.readFileSync(analysedPath!, 'utf8'));
    const get = async (_b: string, p: string) => {
      const file = path.join(partsDir!, path.basename(p));
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    };
    return runRunner(row({ status: 'materializing', materialize_attempts: 1, size_bytes: bytes.length, result: analysed }), { get }, outDir!);
  }
  console.error('usage: cad-parity.ts archive|python-path|rust-path ...');
  process.exit(64);
}
main().catch((e) => { console.error(e); process.exit(1); });
