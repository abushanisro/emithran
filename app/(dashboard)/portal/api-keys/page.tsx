'use client';

import { useState } from 'react';
import { Plus, Copy, Trash2, Key, Check, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/api/hooks/useDeveloper';
import type { ApiKey } from '@/lib/api/developer';

const SCOPE_OPTIONS = [
  { value: 'read',  label: 'Read',  description: 'Fetch data from any endpoint' },
  { value: 'write', label: 'Write', description: 'Create, update, and delete resources' },
] as const;

export default function ApiKeysPage() {
  const { data: keys = [], isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const revokeMutation = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
  const [createdKey, setCreatedKey] = useState<ApiKey | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreate = () => {
    if (!newKeyName.trim() || selectedScopes.length === 0) return;
    createMutation.mutate(
      { name: newKeyName.trim(), scopes: selectedScopes },
      {
        onSuccess: (key) => {
          setCreateOpen(false);
          setNewKeyName('');
          setSelectedScopes(['read']);
          setCreatedKey(key);
        },
      },
    );
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = () => {
    if (!keyToRevoke) return;
    revokeMutation.mutate(keyToRevoke.id, {
      onSuccess: () => setKeyToRevoke(null),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="API Keys" description="Generate and manage API keys for programmatic access">
        <Button onClick={() => setCreateOpen(true)} size="lg" className="gap-2">
          <Plus className="h-4 w-4" />
          New API Key
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Keys</CardTitle>
          <CardDescription>Keys are shown by prefix only — the full key is shown once on creation.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : keys.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed rounded-lg">
              <Key className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="font-semibold mb-2">No API Keys</h3>
              <p className="text-sm text-muted-foreground mb-4">Create your first API key to start making authenticated requests.</p>
              <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2">
                <Plus className="h-4 w-4" /> Create Key
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((key) => (
                <div key={key.id} className="flex items-center justify-between py-4 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Key className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-foreground">{key.name}</p>
                      <code className="text-xs text-muted-foreground font-mono">{key.keyPrefix}••••••••••••••••••••••••••••</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="hidden sm:flex flex-col items-end text-xs text-muted-foreground">
                      <span>Created {format(new Date(key.createdAt), 'MMM d, yyyy')}</span>
                      {key.lastUsedAt && <span>Used {format(new Date(key.lastUsedAt), 'MMM d, yyyy')}</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} variant="outline" className="text-[10px]">{scope}</Badge>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setKeyToRevoke(key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Give your key a descriptive name and choose the permissions it needs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g., Production Integration"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="rounded-lg border border-border divide-y divide-border">
                {SCOPE_OPTIONS.map((s) => (
                  <label
                    key={s.value}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <Checkbox
                      checked={selectedScopes.includes(s.value)}
                      onCheckedChange={() => toggleScope(s.value)}
                    />
                    <div>
                      <p className="text-sm font-medium capitalize">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              {selectedScopes.length === 0 && (
                <p className="text-xs text-destructive">Select at least one permission.</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newKeyName.trim() || selectedScopes.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Show raw key once */}
      <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-400" />
              API Key Created
            </DialogTitle>
            <DialogDescription>Copy your API key now — it will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">Store this key securely. It cannot be recovered after closing this dialog.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <code className="text-xs font-mono text-foreground break-all">{createdKey?.rawKey}</code>
            </div>
            <Button onClick={() => handleCopy(createdKey?.rawKey ?? '')} className="w-full gap-2" variant="outline">
              {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={() => setKeyToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Revoking "{keyToRevoke?.name}" will immediately invalidate all requests using this key. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
