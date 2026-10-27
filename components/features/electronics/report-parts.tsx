'use client';

import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { FeatureGraph, FileReportRow, UploadFeatures } from '@/lib/api/electronics';
import { useReferenceCoverage } from '@/lib/api/hooks/useElectronics';
import { useFxRate } from '@/lib/api/hooks/useFx';
import { describeGraph, roleLabel, unresolvedRows } from '@/lib/electronics/graph-view';

import type { QuoteFlow } from './useQuoteFlow';

// The pieces of the extraction report, used by the stand-alone report (wire harnesses) and by the board workspace panes.

const statusTone: Record<FileReportRow['status'], string> = {
  used: 'bg-emerald-500/10 text-emerald-600',
  reference: 'bg-sky-500/10 text-sky-600',
  ignored: 'bg-muted text-muted-foreground',
};

/** Every uploaded file with the role the platform gave it and whether it was used. */
export function FileTable({ data }: { data: UploadFeatures }) {
  const report = new Map((data.extraction?.filesReport ?? []).map((r) => [r.name, r]));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Used for costing</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.upload.files.map((f) => {
          const r = report.get(f.name);
          return (
            <TableRow key={f.name}>
              <TableCell className="font-mono text-xs">{f.name}</TableCell>
              <TableCell>{f.role ? roleLabel(f.role) : r ? roleLabel(r.role) : 'table'}</TableCell>
              <TableCell>
                {r ? (
                  <span className={`rounded px-2 py-0.5 text-xs ${statusTone[r.status]}`} title={r.note || undefined}>
                    {r.status === 'used' ? 'measured' : r.status === 'reference' ? 'recognised, not measured yet' : 'not needed'}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">graph supplied directly</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Each extracted value with where it came from: measured from a file, supplied by a person, or derived. */
export function FeatureSections({ graph }: { graph: FeatureGraph }) {
  return (
    <div className="space-y-5">
      {describeGraph(graph).map((section) => (
        <div key={section.title}>
          <h3 className="mb-1 text-sm font-medium">{section.title}</h3>
          <dl className="divide-y rounded-md border">
            {section.rows.map((r) => (
              <div key={`${section.title}-${r.label}`} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-3 px-3 py-1.5 text-sm md:grid-cols-[minmax(0,14rem)_1fr_minmax(0,18rem)]">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-medium">{r.value}</dd>
                {r.provenance && <dd className="hidden text-xs text-muted-foreground md:block">{r.provenance}</dd>}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** What the engine cross-checked between the files (drill file against the drill report, and so on). */
export function FindingsList({ graph }: { graph: FeatureGraph }) {
  const findings = graph.findings ?? [];
  if (findings.length === 0) return <p className="text-sm text-muted-foreground">No cross-checks were possible between these files.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {findings.map((f, i) => (
        <li key={i} className="flex items-start gap-2">
          {f.severity === 'warning' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />}
          {f.message}
        </li>
      ))}
    </ul>
  );
}

/** Fields the files do not state. They stay blank; they are never estimated. */
export function UnresolvedList({ graph }: { graph: FeatureGraph }) {
  if (graph.unresolved.length === 0) return <p className="text-sm text-muted-foreground">Everything this design needs is stated by its files.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {unresolvedRows(graph).map((r) => (
        <li key={r.label}><span className="font-mono text-xs">{r.label}</span> — <span className="text-muted-foreground">{r.value}</span></li>
      ))}
    </ul>
  );
}

/** Which assembly processes can be priced yet, and what each still needs. */
export function ProcessNeeds() {
  const { data: coverage } = useReferenceCoverage();
  if (!coverage) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">What each process needs ({coverage.summary.ready} ready, {coverage.summary.pendingConfirmation} awaiting confirmation, {coverage.summary.gap} missing data)</p>
      <ul className="space-y-1 text-sm">
        {coverage.engines.map((e) => (
          <li key={e.id} className="flex items-start gap-2">
            {e.readiness === 'ready' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
            <span>
              <span className="font-medium">{e.label}</span>
              <span className="text-muted-foreground"> — {e.inputs.filter((i) => i.status === 'gap').map((i) => i.requiredSource).join('; ') || (e.readiness === 'pending_confirmation' ? 'data found; needs confirmation for assembled boards' : 'ready')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The batch size input and Calculate button. The batch is never defaulted: the result is a function of it. */
export function BatchInput({ flow }: { flow: QuoteFlow }) {
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="batch-size">Batch size (boards)</Label>
          <Input id="batch-size" inputMode="numeric" value={flow.batch} onChange={(e) => { flow.setBatch(e.target.value); }} placeholder="e.g. 500" className="w-40" />
        </div>
        <Button onClick={() => void flow.calculate()} disabled={!flow.valid || flow.starting || flow.running}>
          {flow.starting || flow.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Calculate
        </Button>
      </div>
      {flow.batch !== '' && !flow.valid && <p className="text-xs text-destructive">Enter a whole number of 1 or more.</p>}
    </div>
  );
}

/** The outcome of the last calculation: per-step lines and a total, or what stops one. A missing rate is reported, never priced at zero. */
export function QuoteOutcome({ flow }: { flow: QuoteFlow }) {
  const { job, result } = flow;
  const currency = result?.result.scenario?.displayCurrency ?? flow.draft.displayCurrency;
  const fx = useFxRate({ base: 'USD', quote: currency, rateType: 'reference', enabled: currency !== 'USD' });
  const rate = currency === 'USD' ? 1 : fx.data?.rate;
  const money = (usd: number) => (rate === undefined ? `${usd.toFixed(3)} USD` : `${(usd * rate).toFixed(currency === 'USD' ? 3 : 2)} ${currency}`);
  const lines = result?.result.lines ?? [];
  return (
    <div className="space-y-3">
      {flow.running && <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Calculating…</div>}
      {job?.state === 'failed' && (
        <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertTitle>The calculation failed</AlertTitle><AlertDescription>{job.error}</AlertDescription></Alert>
      )}
      {!job && !result && <p className="text-sm text-muted-foreground">Set the scenario (location, machines, inputs, batch) and calculate to see the cost, or what is missing to price it.</p>}
      {result && (
        <div className="space-y-3" data-testid="cost-result">
          {result.complete && result.assemblyCostPerUnit !== null ? (
            <p className="text-2xl font-semibold">{money(result.assemblyCostPerUnit)} <span className="text-sm font-normal text-muted-foreground">per board, batch of {result.batchSize}</span></p>
          ) : (
            <Alert>
              <CircleHelp className="h-4 w-4" />
              <AlertTitle>Not priced yet</AlertTitle>
              <AlertDescription>The steps below that could be priced are shown; no total is given until every step has its machine and inputs.</AlertDescription>
            </Alert>
          )}
          {currency !== 'USD' && rate !== undefined && <p className="text-[11px] text-muted-foreground">1 USD = {rate.toFixed(4)} {currency} ({fx.data?.source ?? 'platform rate'}{fx.data?.rateDate ? `, ${fx.data.rateDate}` : ''})</p>}
          {lines.length > 0 && (
            <Table>
              <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Machine</TableHead><TableHead className="text-right">Time/board</TableHead><TableHead className="text-right">Setup</TableHead><TableHead className="text-right">Run</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium" title={(l.calculationTrace ?? []).map((t) => `${t.displayLabel}: ${String(t.value)}${t.unit ? ` ${  t.unit}` : ''}${t.formula ? ` = ${  t.formula}` : t.source ? ` (${  t.source  })` : ''}`).join(' · ')}>{l.process}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.machineName ?? 'stated price'}</TableCell>
                    <TableCell className="text-right text-xs">{l.cycleTimeMin > 0 ? `${(l.cycleTimeMin * 60).toFixed(1)} s` : '—'}</TableCell>
                    <TableCell className="text-right text-xs">{money(l.setupCost)}</TableCell>
                    <TableCell className="text-right text-xs">{money(l.runCost)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{money(l.totalCost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {result.result.gaps.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Still needed</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {result.result.gaps.map((g, i) => (
                  <li key={i}><span className="font-medium text-foreground">{g.process}</span>{g.reason ? `: ${g.reason}` : ''}{g.requiredCapability ? ` ${g.requiredCapability}` : ''}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Batch {result.batchSize} · rate version {result.rateVersion?.slice(0, 12) ?? 'none'} · {result.ratesUsed?.length ?? 0} rate(s) cited · hover a step for its calculation</p>
        </div>
      )}
    </div>
  );
}
