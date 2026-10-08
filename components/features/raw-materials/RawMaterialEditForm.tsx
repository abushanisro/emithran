'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useRawMaterialEditor,
  useRawMaterialFilterOptions,
  useSaveRawMaterialEditor,
  type RawMaterialEditorData,
  type RawMaterialEditorSave,
} from '@/lib/api/hooks/useRawMaterials';

// "specific_heat_rt_j_kg_k" -> "Specific heat rt j kg k". The key is the
// normalized source header; the unit column carries the real unit.
function labelOf(key: string): string {
  const words = key.split('_').filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

// The stock section prices this material in the cost region the page is set to.
const STOCK_LOCATION = 'USA';
// Radix Select cannot hold an empty value, so "no value" is a sentinel in the list only.
const NONE = '__none__';

type CoreDraft = {
  materialGroup: string;
  material: string;
  grade: string;
  materialType: string;
  materialDescription: string;
  costUsa: string;
};

const coreFrom = (m: RawMaterialEditorData['material']): CoreDraft => ({
  materialGroup: m.materialGroup ?? '',
  material: m.material ?? '',
  grade: m.description ?? '',
  materialType: m.materialType ?? '',
  materialDescription: m.materialDescription ?? '',
  costUsa: m.costUsa != null ? String(m.costUsa) : '',
});

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());

// One edit form for a non-ferrous material. It loads once, holds every edit in one
// state object, and saves the whole form with one request (see RawMaterialEditorService).
export function RawMaterialEditForm({ materialId, onClose }: { materialId: string; onClose: () => void }) {
  const { data, isLoading, error } = useRawMaterialEditor(materialId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-red-500">Could not load this material.</p>;
  return <EditBody key={materialId} editor={data} onClose={onClose} />;
}

function EditBody({ editor, onClose }: { editor: RawMaterialEditorData; onClose: () => void }) {
  const materialId = editor.material.id;
  const save = useSaveRawMaterialEditor(materialId);
  const { data: options } = useRawMaterialFilterOptions();

  const initialCore = coreFrom(editor.material);
  const [core, setCore] = useState<CoreDraft>(initialCore);
  const [propDrafts, setPropDrafts] = useState<Record<string, string>>({});
  const [stockDrafts, setStockDrafts] = useState<Record<string, string>>({});

  const initialStock = new Map(
    editor.stockPrices.filter((p) => p.location === STOCK_LOCATION).map((p) => [p.stockForm, String(p.pricePerKg)]),
  );
  const currentText = (p: RawMaterialEditorData['properties'][number]) => (p.valueNum ?? p.valueText ?? '').toString();

  const coreChanged = (Object.keys(core) as Array<keyof CoreDraft>).some((k) => core[k] !== initialCore[k]);
  const propChanges = editor.properties.flatMap((p) => {
    const raw = propDrafts[p.propertyKey];
    return raw === undefined || raw.trim() === currentText(p) ? [] : [{ p, raw: raw.trim() }];
  });
  const stockChanges = editor.stockForms.flatMap((form) => {
    const raw = stockDrafts[form]?.trim();
    return raw === undefined || raw === '' || raw === (initialStock.get(form) ?? '') ? [] : [{ form, raw }];
  });
  const changeCount = (coreChanged ? 1 : 0) + propChanges.length + stockChanges.length;

  // A dropdown keeps the saved value even when it is not in the database list yet.
  const withCurrent = (list: string[] | undefined, current: string) =>
    Array.from(new Set([...(list ?? []), ...(current ? [current] : [])])).sort();

  const onSave = () => {
    if (!core.materialGroup.trim() || !core.material.trim()) {
      toast.error('Process group and source name are required');
      return;
    }
    const costRaw = core.costUsa.trim();
    const cost = costRaw === '' ? null : Number(costRaw);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
      toast.error('Cost must be a non-negative number');
      return;
    }

    const properties: RawMaterialEditorSave['properties'] = [];
    for (const { p, raw } of propChanges) {
      if (p.valueNum !== null) {
        const num = Number(raw);
        if (raw === '' || !Number.isFinite(num)) {
          toast.error(`${labelOf(p.propertyKey)} must be a number`);
          return;
        }
        properties.push({ propertyKey: p.propertyKey, valueNum: num });
      } else {
        properties.push({ propertyKey: p.propertyKey, valueText: raw || null });
      }
    }

    const stockPrices: RawMaterialEditorSave['stockPrices'] = [];
    for (const { form, raw } of stockChanges) {
      const price = Number(raw);
      if (!Number.isFinite(price) || price <= 0) {
        toast.error(`${labelOf(form)}: price must be a positive number`);
        return;
      }
      stockPrices.push({ stockForm: form, location: STOCK_LOCATION, pricePerKg: price });
    }

    save.mutate(
      {
        core: {
          materialGroup: core.materialGroup.trim(),
          material: core.material.trim(),
          grade: blankToNull(core.grade),
          materialType: blankToNull(core.materialType),
          materialDescription: blankToNull(core.materialDescription),
          costUsa: cost,
        },
        properties,
        stockPrices,
      },
      {
        onSuccess: () => {
          toast.success('Material saved');
          onClose();
        },
        onError: (e: Error) => toast.error(e.message || 'Could not save material'),
      },
    );
  };

  const setCoreField = (k: keyof CoreDraft) => (v: string) => setCore((c) => ({ ...c, [k]: v }));

  const dropdown = (label: string, k: 'materialGroup' | 'materialType', list: string[] | undefined, optional: boolean) => {
    const choices = withCurrent(list, core[k]);
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">{label}</label>
        <Select value={core[k] || (optional ? NONE : '')} onValueChange={(v) => setCoreField(k)(v === NONE ? '' : v)}>
          <SelectTrigger>
            <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {optional && <SelectItem value={NONE}>None</SelectItem>}
            {choices.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 p-4 bg-secondary/30 rounded-lg">
        <h3 className="text-sm font-semibold text-foreground">Material</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dropdown('Process group', 'materialGroup', options?.materialGroups, false)}
          <div className="space-y-2">
            <label className="text-sm font-medium">Name (reference key)</label>
            <Input value={editor.material.materialGrade ?? ''} disabled />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Source name *</label>
            <Input value={core.material} onChange={(e) => setCoreField('material')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Grade</label>
            <Input value={core.grade} onChange={(e) => setCoreField('grade')(e.target.value)} />
          </div>
          {dropdown('Material type', 'materialType', options?.materialTypes, true)}
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Description</label>
            <Input value={core.materialDescription} onChange={(e) => setCoreField('materialDescription')(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Cost (USD/kg)</label>
            <Input
              type="number"
              step="0.001"
              placeholder="e.g., 5.981"
              value={core.costUsa}
              onChange={(e) => setCoreField('costUsa')(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 p-4 bg-secondary/30 rounded-lg">
        <h3 className="text-sm font-semibold text-foreground">Properties</h3>
        {editor.properties.length === 0 && <p className="text-xs text-muted-foreground">No properties on file.</p>}
        {editor.properties.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Property</th>
                <th className="py-1 pr-2 font-medium">Value</th>
                <th className="py-1 pr-2 font-medium">Unit</th>
                <th className="py-1 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {editor.properties.map((p) => (
                <tr key={p.propertyKey} className="border-b border-border/40">
                  <td className="py-1 pr-2">{labelOf(p.propertyKey)}</td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-7 font-mono text-xs"
                      type={p.valueNum !== null ? 'number' : 'text'}
                      step="any"
                      value={propDrafts[p.propertyKey] ?? currentText(p)}
                      onChange={(e) => setPropDrafts((d) => ({ ...d, [p.propertyKey]: e.target.value }))}
                    />
                  </td>
                  <td className="py-1 pr-2">{p.unit ?? '—'}</td>
                  <td className="py-1 text-muted-foreground">{p.sourceVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3 p-4 bg-secondary/30 rounded-lg">
        <h3 className="text-sm font-semibold text-foreground">Stock prices ({STOCK_LOCATION}, USD/kg)</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Stock form</th>
              <th className="py-1 pr-2 font-medium text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {editor.stockForms.map((form) => (
              <tr key={form} className="border-b border-border/40">
                <td className="py-1 pr-2">{labelOf(form)}</td>
                <td className="py-1 pr-2 text-right">
                  <Input
                    className="h-7 w-32 ml-auto text-right font-mono text-xs"
                    type="number"
                    step="0.001"
                    placeholder="—"
                    value={stockDrafts[form] ?? initialStock.get(form) ?? ''}
                    onChange={(e) => setStockDrafts((d) => ({ ...d, [form]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">A blank price is left as it is. Prices are shared by every row of this alloy.</p>
      </section>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={onSave} disabled={changeCount === 0 || save.isPending} className="flex-1">
          {save.isPending ? 'Saving…' : `Save changes${changeCount ? ` (${changeCount})` : ''}`}
        </Button>
      </div>
    </div>
  );
}
