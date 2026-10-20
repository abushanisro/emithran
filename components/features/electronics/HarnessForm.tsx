'use client';

import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { StartAssemblyResult, StartUploadResult } from '@/lib/api/electronics';
import { useStartUpload } from '@/lib/api/hooks/useElectronics';
import { buildHarnessGraph, type CircuitInput, type ConnectorInput, type HarnessInput } from '@/lib/electronics/harness-graph';
import { createSingleFlight } from '@/lib/utils/single-flight';

const emptyCircuit = (n: number): CircuitInput => ({ id: `C${n}`, awg: '', lengthMm: '', colour: '', terminalCount: '', sealCount: '' });
const emptyConnector = (n: number): ConnectorInput => ({ id: `J${n}`, cavities: '' });

// A harness has no file to parse, so the values are entered here. Each one is recorded as supplied, with the source the
// person names, and the graph is validated by the platform contract like any other. Nothing is pre-filled or defaulted.
export function HarnessForm({ onUploaded, projectId, designId, parentDesignId }: { onUploaded: (result: StartUploadResult | StartAssemblyResult) => void; projectId?: string; designId?: string; parentDesignId?: string }) {
  const upload = useStartUpload();
  const [flight] = useState(() => createSingleFlight());
  const [designName, setDesignName] = useState('');
  const [input, setInput] = useState<HarnessInput>({
    circuits: [emptyCircuit(1)],
    connectors: [],
    sleeveLengthMm: '',
    grommetCount: '',
    spliceCount: '',
    branchCount: '',
    labelCount: '',
    source: '',
  });
  const [errors, setErrors] = useState<string[]>([]);

  const setCircuit = (i: number, patch: Partial<CircuitInput>) => { setInput((c) => ({ ...c, circuits: c.circuits.map((x, j) => (j === i ? { ...x, ...patch } : x)) })); };
  const setConnector = (i: number, patch: Partial<ConnectorInput>) => { setInput((c) => ({ ...c, connectors: c.connectors.map((x, j) => (j === i ? { ...x, ...patch } : x)) })); };

  const submit = () =>
    flight(async () => {
      const built = buildHarnessGraph(input);
      if (!built.ok) {
        setErrors(built.errors);
        return;
      }
      setErrors([]);
      const file = new File([JSON.stringify(built.graph, null, 2)], 'harness-graph.json', { type: 'application/json' });
      const result = await upload.mutateAsync({ files: [file], kind: 'harness', tier: 'C', ...(designName.trim() ? { designName: designName.trim() } : {}), ...(projectId ? { projectId } : {}), ...(designId ? { designId } : {}), ...(parentDesignId ? { parentDesignId } : {}) });
      onUploaded(result);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Wire harness</CardTitle>
        <CardDescription>Enter the harness from its BOM line or drawing. Every value is recorded as supplied by the source you name.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="harness-name">Design name</Label><Input id="harness-name" value={designName} onChange={(e) => { setDesignName(e.target.value); }} placeholder="Name of this harness" /></div>
          <div className="space-y-1"><Label htmlFor="harness-source">Where these values come from</Label><Input id="harness-source" value={input.source} onChange={(e) => { setInput((c) => ({ ...c, source: e.target.value })); }} placeholder="BOM line, drawing or person" /></div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Circuits (one per conductor)</p>
          {input.circuits.map((c, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[6rem_5rem_7rem_6rem_6rem_6rem_auto]">
              <div className="space-y-1"><Label className="text-xs">Id</Label><Input value={c.id} onChange={(e) => { setCircuit(i, { id: e.target.value }); }} aria-label={`Circuit ${i + 1} id`} /></div>
              <div className="space-y-1"><Label className="text-xs">AWG</Label><Input inputMode="decimal" value={c.awg} onChange={(e) => { setCircuit(i, { awg: e.target.value }); }} aria-label={`Circuit ${i + 1} AWG`} /></div>
              <div className="space-y-1"><Label className="text-xs">Length (mm)</Label><Input inputMode="decimal" value={c.lengthMm} onChange={(e) => { setCircuit(i, { lengthMm: e.target.value }); }} aria-label={`Circuit ${i + 1} length`} /></div>
              <div className="space-y-1"><Label className="text-xs">Colour</Label><Input value={c.colour} onChange={(e) => { setCircuit(i, { colour: e.target.value }); }} aria-label={`Circuit ${i + 1} colour`} /></div>
              <div className="space-y-1"><Label className="text-xs">Terminals (0-2)</Label><Input inputMode="numeric" value={c.terminalCount} onChange={(e) => { setCircuit(i, { terminalCount: e.target.value }); }} aria-label={`Circuit ${i + 1} terminals`} /></div>
              <div className="space-y-1"><Label className="text-xs">Seals (0-2)</Label><Input inputMode="numeric" value={c.sealCount} onChange={(e) => { setCircuit(i, { sealCount: e.target.value }); }} aria-label={`Circuit ${i + 1} seals`} /></div>
              <Button variant="ghost" size="icon" aria-label={`Remove circuit ${i + 1}`} onClick={() => { setInput((s) => ({ ...s, circuits: s.circuits.filter((_, j) => j !== i) })); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => { setInput((c) => ({ ...c, circuits: [...c.circuits, emptyCircuit(c.circuits.length + 1)] })); }}><Plus className="mr-1 h-4 w-4" />Add circuit</Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Connectors</p>
          {input.connectors.map((c, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[6rem_8rem_auto]">
              <div className="space-y-1"><Label className="text-xs">Id</Label><Input value={c.id} onChange={(e) => { setConnector(i, { id: e.target.value }); }} aria-label={`Connector ${i + 1} id`} /></div>
              <div className="space-y-1"><Label className="text-xs">Cavities</Label><Input inputMode="numeric" value={c.cavities} onChange={(e) => { setConnector(i, { cavities: e.target.value }); }} aria-label={`Connector ${i + 1} cavities`} /></div>
              <Button variant="ghost" size="icon" aria-label={`Remove connector ${i + 1}`} onClick={() => { setInput((s) => ({ ...s, connectors: s.connectors.filter((_, j) => j !== i) })); }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => { setInput((c) => ({ ...c, connectors: [...c.connectors, emptyConnector(c.connectors.length + 1)] })); }}><Plus className="mr-1 h-4 w-4" />Add connector</Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          {([['sleeveLengthMm', 'Sleeve length (mm)'], ['grommetCount', 'Grommets'], ['spliceCount', 'Splices'], ['branchCount', 'Branches'], ['labelCount', 'Labels']] as const).map(([key, label]) => (
            <div key={key} className="space-y-1"><Label className="text-xs">{label} (optional)</Label><Input inputMode="decimal" value={input[key]} onChange={(e) => { setInput((c) => ({ ...c, [key]: e.target.value })); }} aria-label={label} /></div>
          ))}
        </div>

        {errors.length > 0 && (
          <Alert variant="destructive"><AlertTitle>Fix these before uploading</AlertTitle><AlertDescription><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></AlertDescription></Alert>
        )}

        <Button onClick={() => void submit()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Create harness
        </Button>
      </CardContent>
    </Card>
  );
}
