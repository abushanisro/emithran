'use client';

import { AlertTriangle, Box, CheckCircle2, ChevronDown, ChevronRight, Layers, Loader2, RefreshCw, UploadCloud, X, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCadUpload, useStartCadUpload } from '@/lib/api/hooks/useCadUploads';
import { describeFailure, summarize, visibleRows } from '@/lib/cad-uploads/upload-view';
import { cn } from '@/lib/utils';

// The one upload limit (MAX_UPLOAD_MB in the env file: the backend and the engine read the same value). Written as a literal
// process.env reference so Next.js compiles it into the bundle; 50 is the Supabase free tier's per-object cap.
const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 50;
const MAX_FILE_SIZE_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ACCEPT = { 'application/zip': ['.zip'], 'application/octet-stream': ['.step', '.stp'], 'application/step': ['.step', '.stp'] };

interface AssemblyTreeGeneratorProps {
  className?: string;
  bomId?: string;
  projectId?: string;
  /** Called once per upload when its BOM items exist, so the BOM table can refresh. */
  onUploaded?: () => void;
}

interface Entry {
  key: string;
  file: File;
  uploadId: string | null;
  error: string | null;
}

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function AssemblyTreeGenerator({ className, bomId, onUploaded }: AssemblyTreeGeneratorProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const start = useStartCadUpload(bomId ?? '');

  const patch = (key: string, change: Partial<Entry>) => { setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...change } : e))); };

  const send = (entry: Entry) => {
    patch(entry.key, { error: null });
    start.mutate(entry.file, {
      onSuccess: (upload) => { patch(entry.key, { uploadId: upload.id }); },
      onError: (error) => { patch(entry.key, { error: error instanceof Error ? error.message : 'The upload failed.' }); },
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
    disabled: !bomId,
    onDrop: (files) => {
      // The same file dropped twice is one upload (the server also treats identical bytes as one).
      const fresh = files.filter((f) => !entries.some((e) => e.key === fileKey(f))).map((file) => ({ key: fileKey(file), file, uploadId: null, error: null }));
      setEntries((prev) => [...prev, ...fresh]);
      fresh.forEach(send);
    },
  });

  return (
    <div className={cn('p-6 pt-0 space-y-4', className)}>
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 transition-colors',
          bomId ? 'cursor-pointer' : 'opacity-50',
          isDragActive ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/40',
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className={cn('h-9 w-9', isDragActive ? 'text-primary' : 'text-muted-foreground')} />
        <div className="text-center">
          <p className="text-sm font-medium">{isDragActive ? 'Release to upload' : 'Drop a .zip of STEP files, or STEP files'}</p>
          <p className="text-xs text-muted-foreground mt-0.5">A zip or an assembly becomes a BOM with quantities. Native CAD: export as STEP (AP242) first.</p>
        </div>
        <p className="text-[11px] text-muted-foreground/60">.zip · .step · .stp · up to {MAX_UPLOAD_MB} MB</p>
      </div>

      {entries.map((entry) => (
        <UploadCard
          key={entry.key}
          entry={entry}
          onRetry={() => { send(entry); }}
          onRemove={() => { setEntries((prev) => prev.filter((e) => e.key !== entry.key)); }}
          onDone={onUploaded}
        />
      ))}
    </div>
  );
}

function UploadCard({ entry, onRetry, onRemove, onDone }: { entry: Entry; onRetry: () => void; onRemove: () => void; onDone: (() => void) | undefined }) {
  const { data: upload } = useCadUpload(entry.uploadId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(true);
  const announced = useRef(false);

  useEffect(() => {
    if (upload?.status === 'done' && !announced.current) {
      announced.current = true;
      onDone?.();
    }
  }, [upload?.status, onDone]);

  const status = entry.error ? 'failed' : (upload?.status ?? 'queued');
  const summary = upload ? summarize(upload) : null;
  const failure = entry.error ?? (upload?.status === 'failed' ? describeFailure(upload) : null);

  return (
    <div className={cn('rounded-lg border', status === 'done' && 'border-green-500/20 bg-green-500/5', status === 'failed' && 'border-red-500/20 bg-red-500/5', (status === 'queued' || status === 'running') && 'border-blue-500/20 bg-blue-500/5')}>
      <div className="flex items-center gap-3 px-4 py-3">
        {status === 'done' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : status === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> : <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{entry.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {status === 'queued' && (entry.uploadId ? 'Waiting to be processed' : 'Uploading')}
            {status === 'running' && `Reading the CAD files${upload && upload.attempts > 1 ? ` (attempt ${upload.attempts})` : ''}`}
            {status === 'done' && summary && `${summary.items} BOM items created from ${summary.distinctParts} distinct parts`}
            {failure && <span className="text-red-600">{failure}</span>}
          </p>
        </div>
        {status === 'done' && upload?.duplicate && <Badge variant="outline">Already uploaded</Badge>}
        {status === 'failed' && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1 h-3 w-3" />Retry
          </Button>
        )}
        {status === 'done' && (
          <button type="button" onClick={() => { setOpen(!open); }} className="text-muted-foreground hover:text-foreground" aria-label={open ? 'Hide tree' : 'Show tree'}>
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {(status === 'done' || status === 'failed') && (
          <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label="Remove">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {status === 'done' && summary && summary.warnings.length > 0 && (
        <ul className="space-y-1 border-t border-border/50 px-4 py-2">
          {summary.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}
            </li>
          ))}
        </ul>
      )}

      {status === 'done' && open && upload?.result && (
        <div className="border-t border-border/50 py-1">
          {visibleRows(upload.result.report.assembly, collapsed).map((row) => (
            <div key={row.key} className="flex items-center gap-2 px-4 py-1 text-sm" style={{ paddingLeft: 16 + row.depth * 20 }}>
              {row.hasChildren ? (
                <button type="button" aria-label="Toggle" onClick={() => { setCollapsed((prev) => { const next = new Set(prev); if (!next.delete(row.key)) next.add(row.key); return next; }); }}>
                  {collapsed.has(row.key) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              ) : <span className="w-3" />}
              {row.kind === 'part' ? <Box className="h-3 w-3 text-muted-foreground" /> : <Layers className="h-3 w-3 text-muted-foreground" />}
              <span className="truncate">{row.name}</span>
              {row.quantity > 1 && <span className="text-xs text-muted-foreground">× {row.quantity}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
