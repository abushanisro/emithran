'use client';

import { FileText, FolderUp, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isAssemblyResult, type StartAssemblyResult, type StartUploadResult, type SuppliedFacts } from '@/lib/api/electronics';
import { useFileFormats, useStartUpload } from '@/lib/api/hooks/useElectronics';
import { classifyFile, extensionOf, roleLabel } from '@/lib/electronics/graph-view';
import { folderName, isFolder, relativePath } from '@/lib/electronics/upload-paths';
import { createSingleFlight } from '@/lib/utils/single-flight';

interface FactField { key: string; label: string; unit: string; hint: string }

// The facts a Gerber set cannot state. The keys are the platform's suppliable facts (backend supplied-facts.ts).
const FACT_FIELDS: FactField[] = [
  { key: 'outline.thicknessMm', label: 'Board thickness', unit: 'mm', hint: 'From the fabrication drawing' },
  { key: 'layers', label: 'Layers stated by the documents', unit: '', hint: 'Checked against the copper files' },
  { key: 'panel.boardsPerPanel', label: 'Boards per panel', unit: '', hint: 'For a panel drawn as one outline' },
];

interface Entry {
  file: File;
  /** Path inside the dropped folder, or just the file name for a loose file. */
  path: string;
}

interface Props {
  onUploaded: (result: StartUploadResult | StartAssemblyResult) => void;
  projectId?: string;
  /** Add a revision to this child part. */
  designId?: string;
  /** Place what is uploaded inside this assembly or sub-assembly. */
  parentDesignId?: string;
  /** Card heading; the page-level upload uses its own title, the Add dialog the default. */
  title?: string;
  description?: string;
}

/**
 * The one way to add electronics: drop files, or a whole folder. Loose files are one design (a PCB, a PCBA or a wire harness,
 * decided by the files). A folder becomes an assembly with sub-assemblies and child parts following its structure.
 */
export function ElectronicsUpload({ onUploaded, projectId, designId, parentDesignId, title, description }: Props) {
  const { data: formats, isLoading, error } = useFileFormats();
  const upload = useStartUpload();
  const [flight] = useState(() => createSingleFlight());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [designName, setDesignName] = useState('');
  const [revision, setRevision] = useState('');
  const [facts, setFacts] = useState<Record<string, { value: string; note: string }>>({});
  const folderInput = useRef<HTMLInputElement>(null);

  const add = useCallback((picked: File[]) => {
    setEntries((current) => {
      const have = new Set(current.map((e) => e.path));
      const fresh = picked.map((file) => ({ file, path: relativePath(file as File & { path?: string }) })).filter((e) => !have.has(e.path));
      return [...current, ...fresh];
    });
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: add, multiple: true, noClick: false });

  const classified = useMemo(
    () => (formats ? entries.map((e) => ({ ...e, kind: classifyFile(e.file.name, formats) })) : []),
    [entries, formats],
  );
  const folder = isFolder(entries.map((e) => e.path));
  const unrecognised = classified.filter((c) => c.kind.kind === 'unrecognised');
  // In a folder, files of a type the platform does not read are left out (and listed); loose files must be removed first.
  const included = folder ? classified.filter((c) => c.kind.kind !== 'unrecognised') : classified;
  // Board facts (thickness, layers, panel) belong to one board; a folder's parts and a feature graph carry their own values.
  const hasBoardFiles = !folder && classified.some((c) => c.kind.kind === 'board');

  // The engine measures the board size from the outline layer. A board set without one is read as failed, so say so before the upload.
  const missingOutline = hasBoardFiles && !classified.some((c) => c.kind.kind === 'board' && c.kind.role === 'board_outline');

  const supplied = useMemo(() => {
    const out: SuppliedFacts = {};
    const problems: string[] = [];
    for (const f of FACT_FIELDS) {
      const entry = facts[f.key];
      if (!entry || entry.value.trim() === '') continue;
      const value = Number(entry.value);
      if (!Number.isFinite(value) || value <= 0) problems.push(`${f.label} must be a number greater than 0`);
      else if (entry.note.trim() === '') problems.push(`${f.label}: say who stated it`);
      else out[f.key] = { value, note: entry.note.trim() };
    }
    return { out, problems };
  }, [facts]);

  const blockedByUnrecognised = !folder && unrecognised.length > 0;
  // A .zip design pack is unpacked on the server and read like the folder it was made from, so it travels on its own.
  const archives = classified.filter((c) => c.kind.kind === 'archive');
  const isPack = archives.length === 1 && classified.length === 1;
  const blockedByMixedArchive = archives.length > 0 && !isPack;
  // Loose files with nothing a design can be read from (a BOM workbook, a drawing): the server would refuse them, so say why
  // first. A board needs its Gerber or drill files; a harness arrives as a feature graph (.json); a pack or folder is planned
  // on the server.
  const nothingToRead =
    !folder && !isPack && included.length > 0 && !included.some((c) => c.kind.kind === 'board' || extensionOf(c.file.name) === 'json');
  const canUpload = included.length > 0 && !blockedByUnrecognised && !blockedByMixedArchive && !nothingToRead && !missingOutline && (!hasBoardFiles || supplied.problems.length === 0) && !upload.isPending;

  const submit = () =>
    flight(async () => {
      let result: StartUploadResult | StartAssemblyResult;
      try {
        result = await upload.mutateAsync({
          files: included.map((e) => e.file),
          ...(folder ? { paths: included.map((e) => e.path) } : {}),
          ...(!folder && designName.trim() ? { designName: designName.trim() } : {}),
          ...(projectId ? { projectId } : {}),
          ...(designId ? { designId } : {}),
          ...(parentDesignId ? { parentDesignId } : {}),
          ...(!folder && revision.trim() ? { revision: revision.trim() } : {}),
          supplied: hasBoardFiles ? supplied.out : {},
        });
      } catch {
        return; // useStartUpload already showed the reason; the picked files stay so they can be corrected
      }
      if (isAssemblyResult(result)) {
        const notes = [
          result.skipped.length > 0 ? `Left out: ${result.skipped.map((s) => `${s.path} (${s.reason})`).join(', ')}.` : '',
          result.unplaced.length > 0 ? `Not in any part: ${result.unplaced.join(', ')}.` : '',
        ].filter(Boolean);
        toast.success(`${result.items.length} part${result.items.length === 1 ? '' : 's'} uploaded from the ${isPack ? 'design pack' : 'folder'}`, notes.length > 0 ? { description: notes.join(' ') } : {});
      } else if (result.reused) {
        toast.info('These exact files were already uploaded', { description: `Showing revision ${result.revision}.` });
      }
      // The page-level card stays mounted after an upload, so it is cleared for the next one.
      setEntries([]);
      setDesignName('');
      setRevision('');
      setFacts({});
      onUploaded(result);
    });

  const name = folderName(entries.map((e) => e.path));

  return (
    <Card>
      <CardHeader>
        <CardTitle className={title ? undefined : 'text-base'}>{title ?? 'Design files'}</CardTitle>
        <CardDescription>
          {description ?? (<>
          One upload for a PCB, a PCBA, a wire harness or a whole assembly. Drop files for one design (the files decide what it is), drop a
          folder, or drop a .zip design pack: a folder or pack becomes the assembly, sub-assemblies and child parts, and every board in it is
          reverse-engineered (size, holes, placements, copper, nets and series chains, spacing).
          </>)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <Alert variant="destructive"><AlertTitle>Could not load the accepted file types</AlertTitle><AlertDescription>Reload the page and try again.</AlertDescription></Alert>}

        <div
          {...getRootProps()}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
          aria-label="Drop design files or a folder here, or click to browse"
        >
          <input {...getInputProps()} data-testid="design-file-input" />
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">{isLoading ? 'Loading accepted types…' : 'Drop a .zip design pack, a folder or design files here, or click to browse'}</p>
          {formats && (
            <p className="max-w-xl text-xs text-muted-foreground">
              Board files: {formats.boardFiles.map((r) => `.${r.extension}`).join(' ')} · Tables: {formats.tabular.map((e) => `.${e}`).join(' ')}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              folderInput.current?.click();
            }}
          >
            <FolderUp className="mr-2 h-4 w-4" />Choose a folder
          </Button>
          <input
            ref={folderInput}
            type="file"
            multiple
            hidden
            data-testid="design-folder-input"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
            {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          />
        </div>

        {folder && (
          <Alert>
            <AlertTitle>Assembly folder{name ? `: ${name}` : ''}</AlertTitle>
            <AlertDescription>
              {included.length} file{included.length === 1 ? '' : 's'} will be uploaded. Folders with a board or harness become child parts, folders above them
              become the assembly and sub-assemblies, and files beside them (a BOM workbook, a requirements document) are kept as reference for the parts below.
              {unrecognised.length > 0 && ` ${unrecognised.length} file${unrecognised.length === 1 ? '' : 's'} of a type the platform does not read will be left out.`}
            </AlertDescription>
          </Alert>
        )}

        {classified.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border" data-testid="picked-files">
            {classified.map(({ file, path, kind }) => (
              <li key={path} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={path}>{folder ? path : file.name}</span>
                <span className={`text-xs ${kind.kind === 'unrecognised' ? (folder ? 'text-amber-600' : 'font-medium text-destructive') : 'text-muted-foreground'}`}>
                  {kind.kind === 'board' ? roleLabel(kind.role) : kind.kind === 'unrecognised' ? (folder ? 'left out: type not accepted' : 'file type not accepted') : kind.kind}
                </span>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${path}`} onClick={() => { setEntries((c) => c.filter((e) => e.path !== path)); }}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {isPack && (
          <Alert data-testid="design-pack">
            <AlertTitle>Design pack: {archives[0]?.file.name}</AlertTitle>
            <AlertDescription>
              The archive is unpacked on the server and read like the folder it was made from. Each board in it (its Gerber, drill and Pick Place
              files) becomes a child part and is reverse-engineered; files of a type the platform does not read are listed afterwards, not dropped silently.
            </AlertDescription>
          </Alert>
        )}
        {nothingToRead && (
          <Alert data-testid="nothing-to-read">
            <AlertTitle>No board or harness in these files</AlertTitle>
            <AlertDescription>
              {included.map((c) => c.file.name).join(', ')} {included.length === 1 ? 'is' : 'are'} kept as reference beside a design, but a design is read from its
              board files (Gerber layers, drill file) or a harness feature graph. Add those files here, or drop the whole .zip design pack or folder, which
              carries the BOM along with every board in it.
            </AlertDescription>
          </Alert>
        )}
        {blockedByMixedArchive && (
          <Alert variant="destructive" data-testid="mixed-archive">
            <AlertTitle>Upload a .zip on its own</AlertTitle>
            <AlertDescription>
              A design pack is unpacked and read as a whole folder, so it cannot be combined with other files or archives in one upload. Remove the other
              files, or unpack the archive and drop its folder instead.
            </AlertDescription>
          </Alert>
        )}

        {blockedByUnrecognised && (
          <Alert variant="destructive">
            <AlertTitle>Remove the files that are not accepted</AlertTitle>
            <AlertDescription>{unrecognised.map((c) => c.file.name).join(', ')} — their file types are not in the platform file-role table.</AlertDescription>
          </Alert>
        )}

        {missingOutline && (
          <Alert data-testid="missing-outline">
            <AlertTitle>No board outline layer in these files</AlertTitle>
            <AlertDescription>
              The board size is measured from the outline layer (the Gerber file that draws the board edge), so these files would be reported as unreadable.
              Add the outline file to continue: drop it here or click the box again, and it joins the files above.
              Added so far: {[...new Set(classified.flatMap((c) => (c.kind.kind === 'board' ? [roleLabel(c.kind.role)] : [])))].join(', ')}.
            </AlertDescription>
          </Alert>
        )}

        {!folder && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="design-name">Design name</Label><Input id="design-name" value={designName} onChange={(e) => { setDesignName(e.target.value); }} placeholder="Defaults to the first file name" /></div>
            <div className="space-y-1"><Label htmlFor="revision">Revision (optional)</Label><Input id="revision" value={revision} onChange={(e) => { setRevision(e.target.value); }} placeholder="e.g. A" /></div>
          </div>
        )}

        {hasBoardFiles && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Facts from your documents <span className="font-normal text-muted-foreground">(optional; a Gerber set cannot state these)</span></p>
            {FACT_FIELDS.map((f) => (
              <div key={f.key} className="grid items-end gap-2 sm:grid-cols-[14rem_8rem_1fr]">
                <Label htmlFor={`fact-${f.key}`} className="text-sm">{f.label}{f.unit ? ` (${f.unit})` : ''}<span className="block text-xs font-normal text-muted-foreground">{f.hint}</span></Label>
                <Input id={`fact-${f.key}`} inputMode="decimal" value={facts[f.key]?.value ?? ''} onChange={(e) => { setFacts((c) => ({ ...c, [f.key]: { value: e.target.value, note: c[f.key]?.note ?? '' } })); }} />
                <Input aria-label={`Who stated ${f.label}`} placeholder="Who stated it (document or person)" value={facts[f.key]?.note ?? ''} onChange={(e) => { setFacts((c) => ({ ...c, [f.key]: { value: c[f.key]?.value ?? '', note: e.target.value } })); }} />
              </div>
            ))}
            {supplied.problems.length > 0 && <p className="text-xs text-destructive">{supplied.problems.join(' · ')}</p>}
          </div>
        )}

        <Button onClick={() => void submit()} disabled={!canUpload}>
          {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}{folder ? 'Upload assembly' : isPack ? 'Upload design pack' : 'Upload and extract'}
        </Button>
      </CardContent>
    </Card>
  );
}
