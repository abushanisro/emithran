'use client';

import { Layers, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DesignView } from '@/lib/api/electronics';
import { useCreateContainer } from '@/lib/api/hooks/useElectronics';
import { createSingleFlight } from '@/lib/utils/single-flight';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  itemType: 'assembly' | 'sub_assembly';
  /** The containers a sub-assembly can go in. */
  containers: DesignView[];
  /** When the person started from an assembly card, the container is fixed. */
  fixedParent: DesignView | null;
}

/** Name an empty assembly or sub-assembly (like adding one to a BOM); child parts are uploaded into it afterwards. */
export function NewContainerDialog({ open, onOpenChange, projectId, itemType, containers, fixedParent }: Props) {
  const create = useCreateContainer();
  const [flight] = useState(() => createSingleFlight());
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const isSub = itemType === 'sub_assembly';
  const parent = isSub ? (fixedParent?.id ?? parentId) : '';
  const label = isSub ? 'Sub-Assembly' : 'Assembly';
  const valid = name.trim().length > 0 && (!isSub || parent !== '');

  const submit = () =>
    flight(async () => {
      await create.mutateAsync({ itemType, name: name.trim(), ...(isSub ? { parentDesignId: parent } : { projectId }) });
      setName('');
      setParentId('');
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-5 w-5" />Add {label}</DialogTitle>
          <DialogDescription>
            {isSub ? 'A sub-assembly groups child parts inside an assembly.' : 'An assembly groups sub-assemblies and child parts, like the top of a BOM.'} It holds no files itself; add boards and harnesses to it afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="container-name">{label} name</Label>
            <Input id="container-name" value={name} onChange={(e) => { setName(e.target.value); }} placeholder={isSub ? 'e.g. Control module' : 'e.g. Main unit'} autoFocus />
          </div>
          {isSub && (
            <div className="space-y-1">
              <Label htmlFor="container-parent">Inside</Label>
              {fixedParent ? (
                <p className="rounded-md border bg-secondary/40 px-3 py-2 text-sm">{fixedParent.name}</p>
              ) : (
                <select id="container-parent" className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={parentId} onChange={(e) => { setParentId(e.target.value); }}>
                  <option value="">Choose an assembly or sub-assembly</option>
                  {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              {!fixedParent && containers.length === 0 && <p className="text-xs text-muted-foreground">Create an assembly first.</p>}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={!valid || create.isPending}>
            {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Add {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
