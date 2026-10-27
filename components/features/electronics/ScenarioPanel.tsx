'use client';

import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useScenarioOptions } from '@/lib/api/hooks/useElectronics';
import { useCurrencies } from '@/lib/api/hooks/useFx';
import { useMHRLocations, useMHRPickerRows } from '@/lib/api/hooks/useMHR';
import type { MHRPickerRow } from '@/lib/api/mhr';

import type { DraftValue, QuoteFlow, ScenarioDraft } from './useQuoteFlow';

const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm';
const MAX_MACHINE_OPTIONS = 200;

function Section({ title, hint, children }: { title: string; hint?: string | undefined; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** One stated value: the number, its unit, and where it comes from. A value is only sent with its source. */
function StatedField({ id, label, unit, hint, value, problem, onChange }: { id: string; label: string; unit: string; hint?: string | undefined; value: DraftValue | undefined; problem?: string | undefined; onChange: (v: DraftValue) => void }) {
  const v = value ?? { value: '', note: '' };
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}{unit ? <span className="font-normal text-muted-foreground"> ({unit})</span> : null}</Label>
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        <Input id={id} inputMode="decimal" value={v.value} onChange={(e) => { onChange({ ...v, value: e.target.value }); }} />
        <Input aria-label={`Source of ${label}`} placeholder="Source (datasheet, line study, quote)" value={v.note} onChange={(e) => { onChange({ ...v, note: e.target.value }); }} />
      </div>
      {hint && <p className="text-[11px] leading-tight text-muted-foreground">{hint}</p>}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** Pick an HR Rates machine at the scenario location: a search box over the machine name, class and process group. */
function MachinePicker({ id, rows, value, onChange }: { id: string; rows: MHRPickerRow[]; value: string | undefined; onChange: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const chosen = rows.find((r) => r.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q === '' ? rows : rows.filter((r) => `${r.machineName} ${r.machineClass ?? ''} ${r.processGroup ?? ''}`.toLowerCase().includes(q));
    return matching.slice(0, MAX_MACHINE_OPTIONS);
  }, [rows, query]);
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">Machine (HR Rates)</Label>
      <Input placeholder={`Search ${rows.length} machines at this location`} value={query} onChange={(e) => { setQuery(e.target.value); }} className="h-8 text-xs" />
      <select id={id} className={selectClass} value={value ?? ''} onChange={(e) => { onChange(e.target.value); }}>
        <option value="">Choose a machine…</option>
        {chosen && !filtered.includes(chosen) && <option value={chosen.id}>{chosen.machineName}</option>}
        {filtered.map((r) => (
          <option key={r.id} value={r.id}>
            {r.machineName}{r.processGroup ? ` · ${r.processGroup}` : ''} · ${r.mhrUsdPerHour.toFixed(2)}/h
          </option>
        ))}
      </select>
      {chosen && <p className="text-[11px] text-muted-foreground">Machine-hour rate ${chosen.mhrUsdPerHour.toFixed(2)}/h; its labour rate and operators come from the same HR Rates row.</p>}
    </div>
  );
}

/**
 * The costing scenario of one board: where it is built (HR Rates location), the display currency, the batch, what the
 * uploaded files hold, the two stated material prices, and per assembly step the HR Rates machine and the inputs it reads.
 * Nothing is defaulted: a step left without its machine or an input reports the gap in the cost result.
 */
export function ScenarioPanel({ uploadId, flow }: { uploadId: string; flow: QuoteFlow }) {
  const options = useScenarioOptions(uploadId);
  const locations = useMHRLocations();
  const currencies = useCurrencies();
  const { draft, setDraft, problems } = flow;
  const machines = useMHRPickerRows(draft.location || undefined, { enabled: draft.location !== '' });

  const set = (patch: Partial<ScenarioDraft>) => { setDraft((d) => ({ ...d, ...patch })); };
  const setInput = (key: string, v: DraftValue) => { setDraft((d) => ({ ...d, inputs: { ...d.inputs, [key]: v } })); };
  const setMachine = (step: string, id: string) => { setDraft((d) => ({ ...d, machines: { ...d.machines, [step]: id } })); };

  const opts = options.data;
  const fact = (key: string) => opts?.facts.find((f) => f.key === key);
  const boards = Number(draft.inputs['panel.boards_in_files']?.value);
  const steps = (opts?.steps ?? []).map((s) => ({ ...s, applies: s.id === 'depanel' ? Number.isFinite(boards) && boards > 1 : s.applies }));
  const factField = (key: string) => {
    const f = fact(key);
    return f ? <StatedField key={key} id={`fact-${key}`} label={f.label} unit={f.unit} value={draft.inputs[key]} problem={problems[key]} onChange={(v) => { setInput(key, v); }} /> : null;
  };

  return (
    <div className="space-y-3">
      <Section title="Digital factory" hint="Where the board is assembled. The machines offered below are the HR Rates machines at this location.">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="scenario-location" className="text-xs">Location</Label>
            <select id="scenario-location" className={selectClass} value={draft.location} onChange={(e) => { set({ location: e.target.value, machines: {} }); }}>
              <option value="">{locations.isLoading ? 'Loading…' : 'Choose a location…'}</option>
              {(locations.data ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="scenario-currency" className="text-xs">Show results in</Label>
            <select id="scenario-currency" className={selectClass} value={draft.displayCurrency} onChange={(e) => { set({ displayCurrency: e.target.value }); }}>
              <option value="USD">USD</option>
              {(currencies.data ?? []).filter((c) => c.code !== 'USD').map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Costs are computed in USD from the HR Rates machine and labour rates, and shown converted at the platform exchange rate.</p>
      </Section>

      <Section title="Volume" hint="The batch spreads the line setup; it is required and never defaulted.">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="batch-size" className="text-xs">Batch size (boards)</Label>
            <Input id="batch-size" inputMode="numeric" value={flow.batch} onChange={(e) => { flow.setBatch(e.target.value); }} placeholder="e.g. 500" />
            {flow.batch !== '' && !flow.valid && <p className="text-xs text-destructive">Enter a whole number of 1 or more.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="annual-volume" className="text-xs">Annual volume (boards, optional)</Label>
            <Input id="annual-volume" inputMode="numeric" value={draft.annualVolume} onChange={(e) => { set({ annualVolume: e.target.value }); }} placeholder="e.g. 6000" />
          </div>
        </div>
      </Section>

      <Section title="What the files hold" hint={opts ? `Measured: ${opts.counts.surfaceMount} surface-mount placements on ${opts.counts.surfaceSides} side(s), ${opts.counts.throughHoleParts} through-hole parts (${opts.counts.throughHoleJoints} joints), outline ${opts.counts.lengthMm} × ${opts.counts.widthMm} mm. Counts are per uploaded file set.` : undefined}>
        {factField('panel.boards_in_files')}
        {Number.isFinite(boards) && boards > 1 && factField('depanel.route_length_per_board_mm')}
      </Section>

      <Section title="Materials" hint="Stated prices: the bare board from the fabricator's quote, the components from BOM pricing. The platform computes neither.">
        {factField('bare_pcb.price_per_board')}
        {factField('components.cost_per_board')}
      </Section>

      <Section title="Assembly steps" hint="For each step this board needs: the HR Rates machine that runs it, and the inputs it reads, each with its source.">
        {options.isLoading && <p className="text-xs text-muted-foreground">Loading the steps…</p>}
        {!draft.location && <p className="text-xs text-amber-600">Choose a location first: the machines are the HR Rates machines at that location.</p>}
        {machines.isLoading && draft.location && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading HR Rates machines…</p>}
        <div className="space-y-3">
          {steps.map((step) => (
            <div key={step.id} className={`space-y-2 rounded-md border p-2 ${step.applies ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{step.label}</p>
                <Badge variant={step.applies ? 'secondary' : 'outline'}>{step.applies ? 'needed for this board' : 'not needed'}</Badge>
              </div>
              {step.applies && (
                <>
                  <MachinePicker id={`machine-${step.id}`} rows={machines.data ?? []} value={draft.machines[step.id]} onChange={(id) => { setMachine(step.id, id); }} />
                  {step.inputs.filter((i) => !i.key.startsWith('depanel.')).map((i) => (
                    <StatedField key={i.key} id={`input-${i.key}`} label={i.key} unit={i.unit} hint={i.requiredSource} value={draft.inputs[i.key]} problem={problems[i.key]} onChange={(v) => { setInput(i.key, v); }} />
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-0 space-y-1 bg-background pt-2">
        <Button className="w-full" onClick={() => void flow.calculate()} disabled={!flow.ready || flow.starting || flow.running}>
          {flow.starting || flow.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Apply scenario and calculate
        </Button>
        {!flow.ready && (
          <p className="text-[11px] text-muted-foreground">
            {!draft.location ? 'Choose a location. ' : ''}{!flow.valid ? 'Enter the batch size. ' : ''}{Object.keys(problems).length > 0 ? 'Fix the values marked in red. ' : ''}
            Steps left without a machine or an input are reported as gaps, not priced.
          </p>
        )}
      </div>
    </div>
  );
}
