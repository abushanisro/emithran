'use client';

import { ArrowLeft, Calculator, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Panel, PanelGroup } from 'react-resizable-panels';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/sidebar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { DesignView, RevisionView } from '@/lib/api/electronics';
import { useReferenceCoverage, useReparse, useUploadFeatures } from '@/lib/api/hooks/useElectronics';
import { listHref, statusLabel, typeLabel } from '@/lib/electronics/design-view';
import { driverInputs, geometryRows, processSteps } from '@/lib/electronics/drivers';

import { HResizeHandle, Pane, VResizeHandle } from './panes';
import { BatchInput, FeatureSections, FileTable, FindingsList, QuoteOutcome, UnresolvedList } from './report-parts';
import { useQuoteFlow } from './useQuoteFlow';
import { useViewerState } from './viewer/useViewerState';
import { ViewerCanvas } from './viewer/ViewerCanvas';
import { ComponentsPanel, LayersPanel, SelectedPanel } from './viewer/ViewerPanels';

const tabList = 'h-8 w-full justify-start rounded-none border-b bg-transparent p-0';
const tabTrigger = 'h-8 rounded-none border-b-2 border-transparent px-3 text-xs data-[state=active]:border-brand-500 data-[state=active]:bg-transparent data-[state=active]:shadow-none';
const scroll = 'h-full overflow-auto';

// Below this width the panes stack instead of splitting, so the workspace stays usable on a tablet or phone.
const DESKTOP = '(min-width: 1024px)';
function useIsDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(DESKTOP);
      query.addEventListener('change', notify);
      return () => { query.removeEventListener('change', notify); };
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
}

const readinessDot: Record<'ready' | 'pending_confirmation' | 'gap', string> = {
  ready: 'bg-emerald-500',
  pending_confirmation: 'bg-amber-500',
  gap: 'bg-red-500',
};
const readinessWords: Record<'ready' | 'pending_confirmation' | 'gap', string> = {
  ready: 'ready',
  pending_confirmation: 'needs confirmation',
  gap: 'needs data',
};

interface Props {
  projectId: string;
  design: DesignView;
  revision: RevisionView;
  /** The upload of that revision (a read revision always has one). */
  uploadId: string;
  onSelectRevision: (revisionId: string) => void;
}

/**
 * The electronics counterpart of the manufacturing-intelligence page, with the same panes: a cost guide (scenario, drawing,
 * features, unknowns), the viewer, the analysis tabs (cost, validation, part info), the manufacturing process and the geometric
 * cost drivers. Everything shown is measured from the uploaded files or recorded by the platform; a missing rate is shown as
 * missing, never priced.
 */
export function ElectronicsIntelligence({ projectId, design, revision, uploadId, onSelectRevision }: Props) {
  const desktop = useIsDesktop();
  const features = useUploadFeatures(uploadId);
  const viewer = useViewerState(uploadId);
  const flow = useQuoteFlow(uploadId);
  const { data: coverage } = useReferenceCoverage();
  const reparse = useReparse();
  const [analysisTab, setAnalysisTab] = useState('cost');

  // Like the part manufacturing-intelligence page: the workspace takes the whole screen, so the app sidebar closes while it is open.
  const { setOpen } = useSidebar();
  useEffect(() => {
    setOpen(false);
    return () => {
      setOpen(true);
    };
  }, [setOpen]);

  const graph = features.data?.featureGraph?.graph ?? null;
  const upload = features.data?.upload;
  const supplied = Object.entries(upload?.supplied ?? {});
  const inFlight = revision.status === 'uploaded' || revision.status === 'parsing';

  const recalculate = () => {
    setAnalysisTab('cost');
    void flow.calculate();
  };

  const topBar = (
    <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild aria-label="Back to the project electronics">
        <Link href={listHref(projectId)}><ArrowLeft className="h-4 w-4" /></Link>
      </Button>
      <h1 className="text-base font-semibold">{design.name}</h1>
      <Badge variant="outline">{typeLabel(design)}</Badge>
      <Badge variant={revision.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(revision.status)}</Badge>
      {design.revisions.length > 1 ? (
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Revision
          <select className="rounded-md border bg-background px-2 py-1 text-foreground" value={revision.id} onChange={(e) => { onSelectRevision(e.target.value); }} aria-label="Revision">
            {design.revisions.map((r) => <option key={r.id} value={r.id}>{r.revision}</option>)}
          </select>
        </label>
      ) : (
        <span className="text-xs text-muted-foreground">Revision {revision.revision}</span>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={inFlight || reparse.isPending} onClick={() => { reparse.mutate(uploadId); }}>
          {reparse.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Refresh analysis
        </Button>
        <Button variant="outline" size="sm" disabled={!flow.valid || flow.starting || flow.running} onClick={recalculate} title={flow.valid ? undefined : 'Enter a batch size in Scenario first'}>
          <Calculator className="mr-1 h-4 w-4" />Recalculate cost
        </Button>
      </div>
    </header>
  );

  const costGuide = (
    <Pane title="Cost guide">
      <Tabs defaultValue="scenario" className="flex h-full flex-col">
        <TabsList className={tabList}>
          <TabsTrigger className={tabTrigger} value="scenario">Scenario</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="drawing">Drawing</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="features">Features</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="unknowns">Unknowns</TabsTrigger>
        </TabsList>
        <TabsContent value="scenario" className={`${scroll} mt-0 space-y-4 p-3`}>
          <BatchInput flow={flow} />
          <div className="space-y-1 text-xs">
            <p className="font-medium">Facts supplied with these files</p>
            {supplied.length === 0 ? (
              <p className="text-muted-foreground">None. Everything comes from the files. To state a fact the files cannot (board thickness, layers, boards per panel), upload a new revision with it.</p>
            ) : (
              <ul className="space-y-0.5">
                {supplied.map(([key, fact]) => (
                  <li key={key}><span className="font-mono">{key}</span> = {fact.value} <span className="text-muted-foreground">({fact.note})</span></li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {flow.result ? `Last calculation used rate version ${flow.result.rateVersion?.slice(0, 12) ?? 'none'}.` : 'The rate version is recorded with each calculation, so a later rate change never alters a stored result.'}
          </p>
        </TabsContent>
        <TabsContent value="drawing" className={`${scroll} mt-0 p-3`}>{features.data ? <FileTable data={features.data} /> : null}</TabsContent>
        <TabsContent value="features" className={`${scroll} mt-0 p-3`}>{graph ? <FeatureSections graph={graph} /> : <p className="text-xs text-muted-foreground">No features were extracted from this revision.</p>}</TabsContent>
        <TabsContent value="unknowns" className={`${scroll} mt-0 p-3`}>
          {graph ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">These stay blank. They are never estimated.</p>
              <UnresolvedList graph={graph} />
            </>
          ) : null}
        </TabsContent>
      </Tabs>
    </Pane>
  );

  const viewerPane = (
    <Pane
      title="Viewer"
      actions={
        <div className="flex items-center gap-1">
          <Badge className="h-5 px-2 text-[10px]">2D</Badge>
          <Badge variant="outline" className="h-5 px-2 text-[10px] opacity-50" title="3D needs component height data, which these files do not carry">3D</Badge>
        </div>
      }
    >
      <ViewerCanvas v={viewer} />
    </Pane>
  );

  const analysis = (
    <Pane title="Analysis">
      <Tabs value={analysisTab} onValueChange={setAnalysisTab} className="flex h-full flex-col">
        <TabsList className={tabList}>
          <TabsTrigger className={tabTrigger} value="cost">Cost</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="validation">Validation</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="info">Part Info</TabsTrigger>
        </TabsList>
        <TabsContent value="cost" className={`${scroll} mt-0 p-3`}><QuoteOutcome flow={flow} /></TabsContent>
        <TabsContent value="validation" className={`${scroll} mt-0 space-y-3 p-3`}>
          {graph ? <FindingsList graph={graph} /> : <p className="text-sm text-muted-foreground">Nothing to check until the files have been read.</p>}
        </TabsContent>
        <TabsContent value="info" className={`${scroll} mt-0 space-y-3 p-3`}>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{design.name}</dd>
            <dt className="text-muted-foreground">Type</dt><dd className="font-medium">{typeLabel(design)}</dd>
            <dt className="text-muted-foreground">Input tier</dt><dd className="font-medium">{upload?.tier ?? '—'}</dd>
            <dt className="text-muted-foreground">Read by</dt><dd className="font-medium">{graph?.extraction ? `${graph.extraction.parserId} ${graph.extraction.parserVersion}` : '—'}</dd>
            <dt className="text-muted-foreground">Review</dt><dd className="font-medium">{features.data?.featureGraph?.reviewStatus.replace('_', ' ') ?? '—'}</dd>
          </dl>
          <Table>
            <TableHeader><TableRow><TableHead>Revision</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
            <TableBody>
              {design.revisions.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.revision}</TableCell>
                  <TableCell><Badge variant={r.status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(r.status)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </Pane>
  );

  const steps = graph && coverage ? processSteps(coverage, graph.kind) : [];
  const process = (
    <Pane title="Manufacturing process" bodyClassName="overflow-auto">
      {!graph || !coverage ? (
        <p className="p-3 text-xs text-muted-foreground">The process is listed once the files have been read.</p>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Process step</TableHead><TableHead>Status</TableHead><TableHead>What is needed</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">{design.name}</TableCell>
              <TableCell colSpan={2} className="text-muted-foreground">{typeLabel(design)}</TableCell>
            </TableRow>
            {steps.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="pl-8">{s.label}</TableCell>
                <TableCell><span className="flex items-center gap-2 text-xs"><span className={`inline-block h-2 w-2 rounded-full ${readinessDot[s.readiness]}`} />{readinessWords[s.readiness]}</span></TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.needs || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Pane>
  );

  const inputs = graph && coverage ? driverInputs(coverage, graph.kind) : [];
  const drivers = (
    <Pane title="Geometric cost drivers">
      <Tabs defaultValue="geometry" className="flex h-full flex-col">
        <TabsList className={tabList}>
          <TabsTrigger className={tabTrigger} value="geometry">Geometry</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="drivers">Cost Drivers</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="components">Components</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="layers">Layers</TabsTrigger>
          <TabsTrigger className={tabTrigger} value="selected">Selected</TabsTrigger>
        </TabsList>
        <TabsContent value="geometry" className={`${scroll} mt-0`}>
          {graph ? (
            <dl className="divide-y text-sm" data-testid="geometry-rows">
              {geometryRows(graph).map((r, i) => (
                <div key={`${r.label}-${i}`} className={`flex items-center justify-between px-3 py-1.5 ${r.depth === 1 ? 'bg-secondary/30 pl-8 text-xs' : ''}`}>
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="font-medium">{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No geometry yet: the files have not been read.</p>
          )}
        </TabsContent>
        <TabsContent value="drivers" className={`${scroll} mt-0`}>
          <Table>
            <TableHeader><TableRow><TableHead>Process</TableHead><TableHead>Input</TableHead><TableHead>Unit</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {inputs.map((d) => (
                <TableRow key={`${d.engine}-${d.key}`} title={d.requiredSource}>
                  <TableCell>{d.engine}</TableCell>
                  <TableCell className="font-mono text-xs">{d.key}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.unit}</TableCell>
                  <TableCell className="text-xs">{d.status === 'sourced' ? 'sourced' : d.status === 'gap' ? 'missing' : 'needs confirmation'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="components" className={`${scroll} mt-0`}><ComponentsPanel v={viewer} /></TabsContent>
        <TabsContent value="layers" className={`${scroll} mt-0`}><LayersPanel v={viewer} /></TabsContent>
        <TabsContent value="selected" className={`${scroll} mt-0`}><SelectedPanel v={viewer} /></TabsContent>
      </Tabs>
    </Pane>
  );

  if (!desktop) {
    return (
      <div className="flex min-h-screen flex-col bg-background" data-testid="electronics-intelligence">
        {topBar}
        <div className="h-[28rem] border-b">{viewerPane}</div>
        <div className="h-[24rem] border-b">{costGuide}</div>
        <div className="h-[24rem] border-b">{analysis}</div>
        <div className="h-[20rem] border-b">{process}</div>
        <div className="h-[24rem]">{drivers}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background" data-testid="electronics-intelligence">
      {topBar}
      <PanelGroup id="ei-root" direction="horizontal" className="min-h-0 flex-1">
        <Panel id="ei-left" order={1} defaultSize={68} minSize={40}>
          <PanelGroup id="ei-left-col" direction="vertical">
            <Panel id="ei-top" order={1} defaultSize={64} minSize={30}>
              <PanelGroup id="ei-top-row" direction="horizontal">
                <Panel id="ei-guide" order={1} defaultSize={32} minSize={18}>{costGuide}</Panel>
                <HResizeHandle />
                <Panel id="ei-viewer" order={2} defaultSize={68} minSize={30}>{viewerPane}</Panel>
              </PanelGroup>
            </Panel>
            <VResizeHandle />
            <Panel id="ei-bottom" order={2} defaultSize={36} minSize={15}>
              <PanelGroup id="ei-bottom-row" direction="horizontal">
                <Panel id="ei-process" order={1} defaultSize={50} minSize={20}>{process}</Panel>
                <HResizeHandle />
                <Panel id="ei-drivers" order={2} defaultSize={50} minSize={20}>{drivers}</Panel>
              </PanelGroup>
            </Panel>
          </PanelGroup>
        </Panel>
        <HResizeHandle />
        <Panel id="ei-right" order={2} defaultSize={32} minSize={20}>{analysis}</Panel>
      </PanelGroup>
    </div>
  );
}
