'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Edit2, Loader2, Save, XCircle, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api/client';
import { useExchangeRates, useSetExchangeRate, type ExchangeRateRow } from '@/lib/api/hooks/useFx';

/**
 * Budget exchange rates (exchange_rates, migration 803): the rates the
 * "Budget" rate type converts with. Each row is "1 USD = rate CCY". Editing a
 * rate requires a reason; the server keeps the replaced rate as history and
 * records who changed it. The reference provenance (source date/author and
 * its active flag) stays visible next to any edit.
 */
export function ExchangeRatesCard() {
  const [expanded, setExpanded] = useState(false);
  const { data: rates, isLoading, error } = useExchangeRates(expanded);
  const setRate = useSetExchangeRate();

  const [editing, setEditing] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState('');
  const [reasonDraft, setReasonDraft] = useState('');

  const startEdit = (row: ExchangeRateRow) => {
    setEditing(row.currency);
    setRateDraft(String(row.rate));
    setReasonDraft('');
  };
  const cancelEdit = () => {
    setEditing(null);
    setRateDraft('');
    setReasonDraft('');
  };

  const parsedRate = Number(rateDraft);
  const canSave = rateDraft.trim() !== '' && parsedRate > 0 && reasonDraft.trim() !== '' && !setRate.isPending;

  const save = (currency: string) => {
    setRate.mutate(
      { currency, rate: parsedRate, reason: reasonDraft.trim() },
      {
        onSuccess: () => {
          toast.success(`Budget rate updated: 1 USD = ${parsedRate} ${currency}`);
          cancelEdit();
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : `Could not update the ${currency} rate`);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          className="flex items-center justify-between w-full text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <div>
            <CardTitle className="flex items-center gap-2">
              {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
              <Coins className="h-5 w-5" />
              Exchange Rates
              {rates && <Badge variant="secondary" className="ml-1">{rates.length}</Badge>}
            </CardTitle>
            <CardDescription>
              Budget FX rates (1 USD = rate) used by the Budget rate type in costing — edit a rate with a reason; every change is kept as history
            </CardDescription>
          </div>
        </button>
      </CardHeader>
      {expanded && (
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading exchange rates...
            </div>
          ) : error ? (
            <div className="py-6 text-sm text-red-500">
              {error instanceof ApiError ? error.message : 'Exchange rates could not be loaded.'}
            </div>
          ) : !rates || rates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No exchange rates on file.</div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">1 USD =</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Set by</TableHead>
                    <TableHead>Reference source</TableHead>
                    <TableHead className="w-[1%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map((row) => {
                    const isEditing = editing === row.currency;
                    return (
                      <TableRow key={row.currency}>
                        <TableCell>
                          <div className="font-medium">{row.currency}</div>
                          {row.name && <div className="text-xs text-muted-foreground">{row.name}</div>}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {isEditing ? (
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={rateDraft}
                              onChange={(e) => setRateDraft(e.target.value)}
                              className="h-8 w-32 ml-auto text-right"
                              autoFocus
                            />
                          ) : (
                            <>{row.rate} {row.currency}</>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.effectiveDate}</TableCell>
                        <TableCell className="text-xs">
                          {isEditing ? (
                            <Input
                              placeholder="Reason (required)"
                              value={reasonDraft}
                              onChange={(e) => setReasonDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && canSave) save(row.currency); }}
                              className="h-8 min-w-[220px]"
                            />
                          ) : row.editedBy ? (
                            <>
                              <div>{row.editedBy}</div>
                              {row.editReason && <div className="text-muted-foreground">{row.editReason}</div>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Reference value</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.sourceModifiedAt ? row.sourceModifiedAt.slice(0, 10) : '—'}
                          {row.sourceModifiedBy ? ` · ${row.sourceModifiedBy}` : ''}
                          {row.sourceActive != null && (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              {row.sourceActive ? 'active' : 'inactive'} in source
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <Button size="sm" onClick={() => save(row.currency)} disabled={!canSave}>
                                {setRate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={setRate.isPending}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(row)}
                              disabled={editing !== null}
                              aria-label={`Edit ${row.currency} rate`}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
