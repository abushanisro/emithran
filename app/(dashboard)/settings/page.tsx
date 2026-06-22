'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  Key, Plus, Copy, Check,
  Camera, Loader2, Activity, CheckCircle2, Clock,
  RefreshCw, ExternalLink, ArrowRight,
  Monitor, Sun, Moon, Building2, Trash2,
  LayoutGrid, Mail, X,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MethodBadge } from '@/components/docs/MethodBadge';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useProfile, useUpdateProfile } from '@/lib/api/hooks/useProfile';
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRequestLogs, useLogStats } from '@/lib/api/hooks/useDeveloper';
import {
  useFeatureProcessMappings,
  useRoutingRules,
  useRoutingTemplates,
  useMachineCapabilities,
} from '@/lib/api/hooks/useManufacturingKnowledge';
import type { FeatureProcessMapping, ProcessRoutingRule, PartFamilyRoutingTemplate, MachineCapability } from '@/lib/api/hooks/useManufacturingKnowledge';
import { useAuth } from '@/lib/providers/auth';
import { supabase } from '@/lib/supabase/client';
import { useTheme } from 'next-themes';
import { useDensity } from '@/lib/providers/density-provider';
import { Switch } from '@/components/ui/switch';
import {
  useMyOrganization, useCreateOrganization, useUpdateOrganization,
  useDeleteOrganization, useOrgMembers, useInviteMember, useRemoveMember,
  useWorkspaces, useCreateWorkspace, useDeleteWorkspace,
} from '@/lib/api/hooks/useOrganization';
import type { ApiKey } from '@/lib/api/developer';
import type { HttpMethod } from '@/lib/docs/api-spec-types';

const TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
];

const SCOPE_OPTIONS = [
  { value: 'read',  label: 'Read',  description: 'Fetch data from any endpoint' },
  { value: 'write', label: 'Write', description: 'Create, update, and delete resources' },
] as const;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// ─────────────────────────────────────────────────────────────
// Preferences Tab
// ─────────────────────────────────────────────────────────────

type ColorMode = 'light' | 'brand' | 'dark';

const COLOR_MODES: { value: ColorMode; label: string; icon: React.FC<{ className?: string }>; preview: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    preview: (
      <div className="w-full h-full rounded-md overflow-hidden bg-gray-50 border border-gray-200 flex">
        {/* mini sidebar */}
        <div className="w-[28%] bg-gray-100 border-r border-gray-200 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-8 rounded-full bg-gray-300" />
          <div className="h-1 w-6 rounded-full bg-gray-200 mt-1" />
          <div className="h-1 w-6 rounded-full bg-gray-200" />
          <div className="h-1 w-5 rounded-full bg-gray-200" />
        </div>
        {/* mini content */}
        <div className="flex-1 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-12 rounded-full bg-gray-300" />
          <div className="h-1 w-full rounded-full bg-gray-200 mt-1" />
          <div className="h-1 w-4/5 rounded-full bg-gray-200" />
          <div className="h-4 w-full rounded bg-gray-100 border border-gray-200 mt-1" />
        </div>
      </div>
    ),
  },
  {
    value: 'brand',
    label: 'System',
    icon: Monitor,
    preview: (
      <div className="w-full h-full rounded-md overflow-hidden flex" style={{ background: 'hsl(220 20% 7%)' }}>
        {/* mini sidebar — brand dark blue */}
        <div className="w-[28%] p-1.5 flex flex-col gap-1" style={{ background: 'hsl(220 20% 5%)', borderRight: '1px solid hsl(220 15% 15%)' }}>
          <div className="h-1.5 w-8 rounded-full" style={{ background: 'hsl(187 100% 42%)' }} />
          <div className="h-1 w-6 rounded-full mt-1" style={{ background: 'hsl(220 15% 25%)' }} />
          <div className="h-1 w-6 rounded-full" style={{ background: 'hsl(220 15% 25%)' }} />
          <div className="h-1 w-5 rounded-full" style={{ background: 'hsl(220 15% 25%)' }} />
        </div>
        {/* mini content */}
        <div className="flex-1 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-12 rounded-full" style={{ background: 'hsl(210 20% 70%)' }} />
          <div className="h-1 w-full rounded-full mt-1" style={{ background: 'hsl(220 15% 18%)' }} />
          <div className="h-1 w-4/5 rounded-full" style={{ background: 'hsl(220 15% 18%)' }} />
          <div className="h-4 w-full rounded mt-1" style={{ background: 'hsl(220 18% 10%)', border: '1px solid hsl(220 15% 18%)' }} />
        </div>
      </div>
    ),
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    preview: (
      <div className="w-full h-full rounded-md overflow-hidden bg-gray-950 border border-gray-800 flex">
        {/* mini sidebar */}
        <div className="w-[28%] bg-gray-900 border-r border-gray-800 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-8 rounded-full bg-gray-600" />
          <div className="h-1 w-6 rounded-full bg-gray-700 mt-1" />
          <div className="h-1 w-6 rounded-full bg-gray-700" />
          <div className="h-1 w-5 rounded-full bg-gray-700" />
        </div>
        {/* mini content */}
        <div className="flex-1 p-1.5 flex flex-col gap-1">
          <div className="h-1.5 w-12 rounded-full bg-gray-600" />
          <div className="h-1 w-full rounded-full bg-gray-800 mt-1" />
          <div className="h-1 w-4/5 rounded-full bg-gray-800" />
          <div className="h-4 w-full rounded bg-gray-900 border border-gray-800 mt-1" />
        </div>
      </div>
    ),
  },
];

const DENSITY_OPTIONS = [
  {
    value: 'comfortable' as const,
    label: 'Comfortable',
    description: 'More spacing, easier to read',
    preview: (
      <div className="w-full h-full flex flex-col gap-2 p-3 bg-card rounded-md border border-border">
        <div className="h-2 w-24 rounded bg-muted" />
        <div className="h-8 w-full rounded bg-muted/60 border border-border" />
        <div className="h-8 w-full rounded bg-muted/60 border border-border" />
        <div className="h-8 w-3/4 rounded bg-muted/60 border border-border" />
      </div>
    ),
  },
  {
    value: 'compact' as const,
    label: 'Compact',
    description: 'Tighter layout, more on screen',
    preview: (
      <div className="w-full h-full flex flex-col gap-1 p-2 bg-card rounded-md border border-border">
        <div className="h-1.5 w-20 rounded bg-muted" />
        <div className="h-6 w-full rounded bg-muted/60 border border-border" />
        <div className="h-6 w-full rounded bg-muted/60 border border-border" />
        <div className="h-6 w-full rounded bg-muted/60 border border-border" />
        <div className="h-6 w-3/4 rounded bg-muted/60 border border-border" />
      </div>
    ),
  },
] as const;

function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { density, setDensity } = useDensity();
  const currentTheme = (theme as ColorMode) ?? 'dark';

  return (
    <div className="space-y-10 w-full">

      {/* Appearance section */}
      <section>
        <div className="mb-6">
          <h3 className="text-base font-semibold">Appearance</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Customize how mithran looks on your device.
          </p>
        </div>

        {/* Color mode */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">Color mode</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Choose whether the app's appearance should be light, dark, or use your computer's settings.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {COLOR_MODES.map(({ value, label, icon: Icon, preview }) => {
              const active = currentTheme === value;
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className={`group relative flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    active
                      ? 'border-primary bg-primary/5 shadow-[0_0_0_3px] shadow-primary/10'
                      : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30'
                  }`}
                >
                  {/* Preview thumbnail */}
                  <div className="aspect-video w-full rounded-lg overflow-hidden shadow-sm ring-1 ring-border/50">
                    {preview}
                  </div>

                  {/* Label row */}
                  <div className="flex items-center gap-2">
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className={`text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {label}
                    </span>
                    {active && (
                      <span className="ml-auto h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="h-px bg-border" />

      {/* Density section */}
      <section>
        <div className="mb-6">
          <h3 className="text-base font-semibold">Interface density</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Adjust how compact the interface appears. Changes apply instantly across the whole app.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {DENSITY_OPTIONS.map(({ value, label, description, preview }) => {
            const active = density === value;
            return (
              <button
                key={value}
                onClick={() => setDensity(value)}
                className={`group flex flex-col gap-3 rounded-xl border-2 p-3 text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  active
                    ? 'border-primary bg-primary/5 shadow-[0_0_0_3px] shadow-primary/10'
                    : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30'
                }`}
              >
                {/* Preview */}
                <div className="aspect-video w-full rounded-lg overflow-hidden ring-1 ring-border/50">
                  {preview}
                </div>
                {/* Label */}
                <div className="flex items-center gap-2">
                  <div className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 transition-colors ${active ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`} />
                  <div>
                    <p className={`text-sm font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  {active && <span className="ml-auto h-2 w-2 rounded-full bg-primary shrink-0" />}
                </div>
              </button>
            );
          })}
        </div>
      </section>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Profile Tab
// ─────────────────────────────────────────────────────────────
function ProfileTab() {
  const { user } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const updateMutation = useUpdateProfile();

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName ?? '');
    setBio(profile.bio ?? '');
    setJobTitle(profile.jobTitle ?? '');
    setPhone(profile.phone ?? '');
    setTimezone(profile.timezone ?? 'UTC');
  }, [profile]);

  const initials = (profile?.displayName || user?.email || 'U')
    .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !supabase) return;
    const ext = file.name.split('.').pop();
    const path = `${user.id}/avatar.${ext}`;
    setAvatarUploading(true);
    try {
      const { error: uploadError } = await supabase.storage
        .from('avatars').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await updateMutation.mutateAsync({ avatarUrl: `${publicUrl}?t=${Date.now()}` });
    } catch {
      toast.error('Avatar upload failed');
    } finally {
      setAvatarUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile Picture</CardTitle>
          <CardDescription>Click the avatar to upload a new photo (JPEG / PNG / WebP).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="relative group">
              <Avatar className="h-20 w-20 border-2 border-border">
                <AvatarImage src={profile?.avatarUrl ?? undefined} />
                <AvatarFallback className="text-xl bg-primary/10 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={avatarUploading}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {avatarUploading
                  ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                  : <Camera className="h-5 w-5 text-white" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            </div>
            <div className="space-y-0.5">
              <p className="font-medium text-sm">{profile?.displayName || user?.email}</p>
              <p className="text-xs text-muted-foreground">{profile?.email || user?.email}</p>
              {profile?.jobTitle && <p className="text-xs text-muted-foreground">{profile.jobTitle}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your full name" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile?.email || user?.email || ''} disabled className="opacity-60" />
              <p className="text-xs text-muted-foreground">Managed by your auth provider.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Job Title</Label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Principal Engineer" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label>Bio</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A short description about yourself…" rows={3} />
          </div>
          <div className="flex justify-end pt-2 sm:col-span-2 lg:col-span-3">
            <Button onClick={() => updateMutation.mutate({ displayName, bio, jobTitle, phone, timezone })} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Save Changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// API Keys Tab  (Claude-platform-style table)
// ─────────────────────────────────────────────────────────────
function ApiKeysTab() {
  const { data: keys = [], isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const revokeMutation = useRevokeApiKey();
  const { data: org } = useMyOrganization();
  const { data: workspaces = [] } = useWorkspaces(org?.id);

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);
  const [selectedWorkspace, setSelectedWorkspace] = useState('default');
  const [createdKey, setCreatedKey] = useState<ApiKey | null>(null);
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleScope = (scope: string) =>
    setSelectedScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);

  const handleCreate = () => {
    if (!newKeyName.trim() || selectedScopes.length === 0) return;
    createMutation.mutate({ name: newKeyName.trim(), scopes: selectedScopes }, {
      onSuccess: (key) => { setCreateOpen(false); setNewKeyName(''); setSelectedScopes(['read']); setSelectedWorkspace('default'); setCreatedKey(key); },
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-8 w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">API keys</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Keys are shown by prefix only. The full key is displayed once on creation and cannot be recovered.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          Create Key
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_160px_130px_130px_80px] gap-0 border-b border-border bg-muted/40 px-4 py-2.5">
          {['Name', 'Key', 'Created', 'Last used', ''].map((h) => (
            <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</span>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm font-medium">No API keys yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a key to start making authenticated requests.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              Create your first key
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((key) => (
              <div key={key.id} className="grid grid-cols-[1fr_160px_130px_130px_80px] gap-0 px-4 py-3.5 items-center hover:bg-muted/20 transition-colors">
                {/* Name + scopes */}
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-medium truncate">{key.name}</p>
                  <div className="flex gap-1 mt-0.5">
                    {key.scopes.map((s) => (
                      <span key={s} className="text-[10px] text-muted-foreground capitalize">{s}</span>
                    ))}
                  </div>
                </div>
                {/* Key prefix */}
                <code className="text-xs font-mono text-muted-foreground pr-4 truncate">
                  {key.keyPrefix}••••••••••••
                </code>
                {/* Created */}
                <span className="text-xs text-muted-foreground pr-4">
                  {format(new Date(key.createdAt), 'MMM d, yyyy')}
                </span>
                {/* Last used */}
                <span className="text-xs text-muted-foreground pr-4">
                  {key.lastUsedAt ? format(new Date(key.lastUsedAt), 'MMM d, yyyy') : 'Never'}
                </span>
                {/* Actions */}
                <button
                  onClick={() => setKeyToRevoke(key)}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors font-medium"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Permissions info */}
      <div className="rounded-lg border border-border p-4 space-y-3 bg-muted/20">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Permission scopes</p>
        <div className="space-y-2">
          {SCOPE_OPTIONS.map((s) => (
            <div key={s.value} className="flex gap-3 text-sm">
              <span className="font-medium w-12 capitalize shrink-0">{s.label}</span>
              <span className="text-muted-foreground">{s.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Give your key a name and choose the permissions it needs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div className="space-y-1.5">
              <Label>Key name</Label>
              <Input
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Production Integration"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>

            {/* Workspace selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Workspace</Label>
                {!org && (
                  <Link
                    href="/settings?tab=organization"
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Create organization
                  </Link>
                )}
              </div>
              <Select value={selectedWorkspace} onValueChange={setSelectedWorkspace}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default workspace</SelectItem>
                  {workspaces.filter((w) => !w.isDefault).map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="rounded-lg border border-border divide-y divide-border">
                {SCOPE_OPTIONS.map((s) => (
                  <label key={s.value} className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40 transition-colors">
                    <Checkbox
                      className="mt-0.5"
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
            <Button onClick={handleCreate} disabled={!newKeyName.trim() || selectedScopes.length === 0 || createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create Key'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Show raw key once ── */}
      <Dialog open={!!createdKey} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>Copy this key now. For security reasons, it won't be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
              <p className="text-xs text-amber-400 font-medium">
                This API key will not be shown again. Store it somewhere safe, such as a password manager or secrets vault.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-4 py-3 flex items-center gap-3">
              <code className="text-xs font-mono text-foreground break-all flex-1">{createdKey?.rawKey}</code>
              <button
                onClick={() => handleCopy(createdKey?.rawKey ?? '')}
                className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                {copied ? <><Check className="h-3.5 w-3.5 text-green-400" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy</>}
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => handleCopy(createdKey?.rawKey ?? '')}>
              {copied ? 'Copied!' : 'Copy key'}
            </Button>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revoke confirmation ── */}
      <AlertDialog open={!!keyToRevoke} onOpenChange={() => setKeyToRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke "{keyToRevoke?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately invalidate the key. Any integrations using it will stop working. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeMutation.mutate(keyToRevoke!.id, { onSuccess: () => setKeyToRevoke(null) })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Developer Portal Tab
// ─────────────────────────────────────────────────────────────
function DeveloperPortalTab() {
  const { data: stats, isLoading: statsLoading } = useLogStats();
  const { data: keys } = useApiKeys();

  const statCards = [
    { label: 'Active API Keys', value: keys?.length ?? 0, icon: Key, color: 'text-primary', bg: 'bg-primary/10', border: 'border-l-primary' },
    { label: 'Requests (30d)', value: statsLoading ? '…' : (stats?.total ?? 0).toLocaleString(), icon: Activity, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-l-blue-500' },
    { label: 'Success Rate', value: statsLoading ? '…' : `${stats?.successRate ?? 0}%`, icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-l-green-500' },
    { label: 'Avg Response', value: statsLoading ? '…' : `${stats?.avgDurationMs ?? 0}ms`, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-l-amber-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">API usage overview for the last 30 days.</p>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link href="/developer" target="_blank"><ExternalLink className="h-4 w-4" />API Reference</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map((card) => (
          <Card key={card.label} className={`border-l-4 ${card.border}`}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-xl ${card.bg} flex items-center justify-center`}>
                  <card.icon className={`h-6 w-6 ${card.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{card.label}</p>
                  <p className="text-2xl font-bold">{card.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-base">API Keys</CardTitle>
            <CardDescription>Generate, view, and revoke API keys for programmatic access.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="gap-2 w-full">
              <Link href="/settings?tab=api-keys">Manage Keys <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/40 transition-colors">
          <CardHeader>
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
              <Activity className="h-5 w-5 text-blue-400" />
            </div>
            <CardTitle className="text-base">Request Logs</CardTitle>
            <CardDescription>View your API request history with status codes and timings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm" className="gap-2 w-full">
              <Link href="/settings?tab=logs">View Logs <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {stats?.topEndpoints && stats.topEndpoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Endpoints (Last 30 Days)</CardTitle>
            <CardDescription>Most frequently called API endpoints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.topEndpoints.map((ep) => (
                <div key={ep.path} className="flex items-center justify-between gap-4">
                  <code className="text-xs font-mono text-muted-foreground truncate">{ep.path}</code>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-1.5 rounded-full bg-primary/40" style={{ width: `${Math.max(20, (ep.count / (stats.topEndpoints[0]?.count ?? 1)) * 120)}px` }} />
                    <span className="text-xs text-muted-foreground w-16 text-right">{ep.count.toLocaleString()} req</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Request Logs Tab
// ─────────────────────────────────────────────────────────────
function StatusBadge({ code }: { code: number }) {
  const color =
    code >= 200 && code < 300 ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : code >= 400 && code < 500 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-red-500/15 text-red-400 border-red-500/30';
  return <Badge variant="outline" className={`font-mono text-[11px] ${color}`}>{code}</Badge>;
}

function RequestLogsTab() {
  const [method, setMethod] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const statusRange =
    statusFilter === '2xx' ? { statusMin: 200, statusMax: 299 }
    : statusFilter === '4xx' ? { statusMin: 400, statusMax: 499 }
    : statusFilter === '5xx' ? { statusMin: 500, statusMax: 599 }
    : {};

  const { data, isLoading, refetch } = useRequestLogs({ page, limit: 50, method: method || undefined, ...statusRange });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={method} onValueChange={(v) => { setMethod(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Methods" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            {HTTP_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="All Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="2xx">2xx Success</SelectItem>
            <SelectItem value="4xx">4xx Client Error</SelectItem>
            <SelectItem value="5xx">5xx Server Error</SelectItem>
          </SelectContent>
        </Select>

        {(method || statusFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setMethod(''); setStatusFilter(''); setPage(1); }}>Clear filters</Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{total.toLocaleString()} total</span>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No requests found</div>
          ) : (
            <div className="divide-y divide-border">
              <div className="grid grid-cols-[80px_1fr_60px_80px_140px] gap-4 px-4 py-2 bg-muted/30 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <span>Method</span><span>Path</span><span>Status</span><span>Duration</span><span>Time</span>
              </div>
              {logs.map((log) => (
                <div key={log.id} className="grid grid-cols-[80px_1fr_60px_80px_140px] gap-4 px-4 py-3 hover:bg-muted/20 transition-colors items-center">
                  <MethodBadge method={log.method as HttpMethod} size="sm" />
                  <code className="text-xs font-mono text-muted-foreground truncate" title={log.path}>{log.path}</code>
                  <StatusBadge code={log.statusCode} />
                  <span className="text-xs text-muted-foreground">{log.durationMs != null ? `${log.durationMs}ms` : '—'}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {total > 50 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / 50)}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total}>Next</Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Organization Tab
// ─────────────────────────────────────────────────────────────
const ENTITY_TYPES = ['Individual', 'Startup', 'Small Business', 'Enterprise', 'Non-profit', 'Academic Institution', 'Government'];
const CUSTOMER_TYPES = [
  { value: 'internal', label: 'Internal customers' },
  { value: 'external', label: 'External customers' },
  { value: 'both',     label: 'Both' },
];
const COUNTRIES = [
  'India', 'United States', 'United Kingdom', 'Germany', 'France',
  'Japan', 'China', 'Singapore', 'Australia', 'Canada', 'Brazil', 'Other',
];
const USE_TAGS = [
  'BOM Management',
  'Production Planning',
  'Process Planning',
  'Quality Control',
  'Vendor Management',
  'Supplier Evaluation',
  'RFQ & Quotations',
  'Raw Materials',
  'Benchmarking',
  'VAVE',
  'Delivery Tracking',
  'Project Management',
  'Cost Analysis',
  'MHR / LHR Database',
  'Supplier Nominations',
  'Process Costing',
];
const MEMBER_ROLES = ['admin', 'member', 'viewer'] as const;

function CreateOrgDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createMutation = useCreateOrganization();
  const [_step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('');
  const [country, setCountry] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [apiUseCase, setApiUseCase] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [legalMedical, setLegalMedical] = useState(false);
  const [under18, setUnder18] = useState(false);

  const toggleTag = (t: string) =>
    setTags((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t]);

  const reset = () => {
    setStep(1); setName(''); setEntityType(''); setCountry('');
    setCustomerType(''); setApiUseCase(''); setTags([]);
    setLegalMedical(false); setUnder18(false);
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      { name: name.trim(), entityType, country, customerType, apiUseCase, useTags: tags, legalMedicalFinancial: legalMedical, under18 },
      { onSuccess: () => { reset(); onClose(); } },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-[560px] flex flex-col max-h-[90vh] overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl font-bold text-center">Let's get your organization details</DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 pr-1 space-y-5 py-2">
          {/* Organization name */}
          <div className="space-y-1.5">
            <Label>Organization name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Manufacturing Co." />
          </div>

          {/* Entity type */}
          <div className="space-y-1.5">
            <Label>What type of entity is your organization?</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <Label>Where is your organization?</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Customer type */}
          <div className="space-y-1.5">
            <Label>Are you building for internal customers, external customers or both?</Label>
            <Select value={customerType} onValueChange={setCustomerType}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {CUSTOMER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* API use case */}
          <div className="space-y-2">
            <Label>What are you planning on using the API for?</Label>
            <Textarea value={apiUseCase} onChange={(e) => setApiUseCase(e.target.value)} placeholder="e.g. Automating BOM costing, vendor evaluation, production planning…" rows={2} />
            <div className="flex flex-wrap gap-2 pt-1">
              {USE_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    tags.includes(t)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                  }`}
                >
                  {tags.includes(t) ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Yes/No questions */}
          <div className="space-y-3">
            {[
              { label: 'Will the API be used to provide legal, medical, or financial advice to consumers?', value: legalMedical, set: setLegalMedical },
              { label: 'Will you be using the API in any products or services intended for users under age 18?', value: under18, set: setUnder18 },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
                <p className="text-sm leading-snug text-foreground">{label}</p>
                <div className="flex items-center gap-1 shrink-0">
                  {(['Yes', 'No'] as const).map((opt) => {
                    const isYes = opt === 'Yes';
                    const active = isYes ? value : !value;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => set(isYes)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                          active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* sticky footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : 'Submit'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrganizationTab() {
  const { data: org, isLoading } = useMyOrganization();
  const updateMutation = useUpdateOrganization();
  const deleteMutation = useDeleteOrganization();
  const { data: members = [] } = useOrgMembers(org?.id);
  const inviteMutation = useInviteMember(org?.id ?? '');
  const removeMember = useRemoveMember(org?.id ?? '');

  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  // Editable org fields
  const [orgName, setOrgName]           = useState('');
  const [address1, setAddress1]         = useState('');
  const [address2, setAddress2]         = useState('');
  const [country, setCountry]           = useState('');
  const [state, setState]               = useState('');
  const [city, setCity]                 = useState('');
  const [postal, setPostal]             = useState('');
  const [taxId, setTaxId]               = useState('');
  const [allowKeys, setAllowKeys]       = useState(true);
  const [orgInitialized, setOrgInitialized] = useState(false);

  useEffect(() => {
    if (!org || orgInitialized) return;
    setOrgName(org.name);
    setAddress1(org.addressLine1 ?? '');
    setAddress2(org.addressLine2 ?? '');
    setCountry(org.country ?? '');
    setState(org.stateProvince ?? '');
    setCity(org.city ?? '');
    setPostal(org.postalCode ?? '');
    setTaxId(org.taxId ?? '');
    setAllowKeys(org.allowDefaultWorkspaceKeys);
    setOrgInitialized(true);
  }, [org, orgInitialized]);

  const handleSave = () => {
    if (!org) return;
    updateMutation.mutate(
      { id: org.id, data: { name: orgName, addressLine1: address1, addressLine2: address2, country, stateProvince: state, city, postalCode: postal, taxId } },
      { onSuccess: () => setEditing(false) },
    );
  };

  const handleCancelEdit = () => {
    // reset to saved values
    if (org) {
      setOrgName(org.name);
      setAddress1(org.addressLine1 ?? '');
      setAddress2(org.addressLine2 ?? '');
      setCountry(org.country ?? '');
      setState(org.stateProvince ?? '');
      setCity(org.city ?? '');
      setPostal(org.postalCode ?? '');
      setTaxId(org.taxId ?? '');
    }
    setEditing(false);
  };

  const handleToggleAllowKeys = (val: boolean) => {
    setAllowKeys(val);
    if (org) updateMutation.mutate({ id: org.id, data: { allowDefaultWorkspaceKeys: val } });
  };

  const copyOrgId = () => {
    if (!org) return;
    navigator.clipboard.writeText(org.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    inviteMutation.mutate({ email: inviteEmail.trim(), role: inviteRole }, {
      onSuccess: () => { setInviteOpen(false); setInviteEmail(''); setInviteRole('member'); },
    });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // ── No org yet — minimal create prompt ──
  if (!org) {
    return (
      <div className="space-y-4 w-full">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Organization</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Manage your organization, members, and workspace access.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New organization
          </Button>
        </div>
        <div className="rounded-xl border-2 border-dashed border-border p-12 text-center">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No organization yet.</p>
        </div>
        <CreateOrgDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    );
  }

  // ── Org exists ──
  return (
    <div className="space-y-8 w-full">
      {/* Header + detail card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-6">

        {/* Top row: name + members + edit button */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-1">Organization</p>
            {editing
              ? <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="text-lg font-bold h-9 max-w-xs" />
              : <h2 className="text-xl font-bold">{org.name}</h2>}
          </div>
          <div className="flex items-start gap-6 shrink-0">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Members</p>
              <p className="text-2xl font-bold">{members.length || 1}</p>
            </div>
            {!editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        </div>

        {/* VIEW MODE */}
        {!editing && (
          <div className="space-y-5 text-sm">
            {/* Address block */}
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">Primary business address</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                {[
                  { label: 'Line 1',           value: address1 },
                  { label: 'Line 2',           value: address2 },
                  { label: 'Country',          value: country  },
                  { label: 'State / Province', value: state    },
                  { label: 'City',             value: city     },
                  { label: 'Postal code',      value: postal   },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                    <p className={value ? 'text-foreground font-medium' : 'text-muted-foreground/40 italic'}>
                      {value || '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Tax ID */}
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">Business tax ID</p>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">GST / VAT / EIN</p>
                <p className={taxId ? 'font-mono text-foreground font-medium' : 'text-muted-foreground/40 italic'}>
                  {taxId || '—'}
                </p>
              </div>
            </div>

            {/* Org ID */}
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-3">Organization ID</p>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <code className="flex-1 text-xs font-mono select-all">{org.id}</code>
                <button onClick={copyOrgId} className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {copied
                    ? <><Check className="h-3.5 w-3.5 text-green-400" /><span className="text-green-400">Copied</span></>
                    : <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* EDIT MODE */}
        {editing && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Primary business address</p>
              <div className="grid grid-cols-2 gap-3">
                <Input value={address1} onChange={(e) => setAddress1(e.target.value)} placeholder="Line 1" />
                <Input value={address2} onChange={(e) => setAddress2(e.target.value)} placeholder="Line 2" />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Country</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Country" /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">State / Province</Label>
                <Input className="h-9" value={state} onChange={(e) => setState(e.target.value)} placeholder="State" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input className="h-9" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Postal code</Label>
                <Input className="h-9" value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="000000" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Business tax ID</Label>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground w-32 shrink-0">GST / VAT / EIN</span>
                <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="12ABCDE3456FGH" className="max-w-xs" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Organization ID</Label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                <code className="flex-1 text-xs font-mono select-all">{org.id}</code>
                <button onClick={copyOrgId} className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <><Check className="h-3.5 w-3.5 text-green-400" /><span className="text-green-400">Copied</span></> : <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={handleCancelEdit}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Allow default workspace API keys toggle */}
      <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium">Allow creating new API keys in default workspace</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Allow members to create new API keys in the default workspace. Disabling does not affect existing keys.
          </p>
        </div>
        <Switch checked={allowKeys} onCheckedChange={handleToggleAllowKeys} />
      </div>

      {/* Team Members */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Team members</h3>
            <p className="text-sm text-muted-foreground">Manage who has access to this organization.</p>
          </div>
          <Button size="sm" className="gap-2" onClick={() => setInviteOpen(true)}>
            <Mail className="h-4 w-4" /> Invite member
          </Button>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_100px_48px] border-b border-border bg-muted/40 px-4 py-2.5">
            {['Member', 'Role', 'Status', ''].map((h) => (
              <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</span>
            ))}
          </div>
          {members.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No members yet. Invite your teammates.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {members.map((m) => (
                <div key={m.id} className="grid grid-cols-[1fr_120px_100px_48px] px-4 py-3 items-center hover:bg-muted/20 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.displayName || m.email || m.invitedEmail}</p>
                    {m.displayName && <p className="text-xs text-muted-foreground truncate">{m.email || m.invitedEmail}</p>}
                  </div>
                  <Badge variant="outline" className="w-fit capitalize text-[11px]">{m.role}</Badge>
                  <span className={`text-xs font-medium capitalize ${m.status === 'active' ? 'text-green-400' : 'text-amber-400'}`}>
                    {m.status}
                  </span>
                  {m.role !== 'owner' ? (
                    <button
                      onClick={() => removeMember.mutate(m.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h3 className="text-sm font-semibold text-destructive mb-1">Danger zone</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Deleting the organization is permanent. All workspaces, members, and API keys in this organization will be removed.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(true)}>
          Delete organization
        </Button>
      </div>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
            <DialogDescription>They'll receive an email to join your organization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviteMutation.isPending}>
              {inviteMutation.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{org.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the organization, all its workspaces, members, and API keys. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(org.id, { onSuccess: () => setDeleteConfirm(false) })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Workspaces Tab
// ─────────────────────────────────────────────────────────────
function WorkspacesTab() {
  const { data: org, isLoading: orgLoading } = useMyOrganization();
  const { data: workspaces = [], isLoading: wsLoading } = useWorkspaces(org?.id);
  const createMutation = useCreateWorkspace(org?.id ?? '');
  const deleteMutation = useDeleteWorkspace(org?.id ?? '');

  const [createOpen, setCreateOpen] = useState(false);
  const [wsName, setWsName] = useState('');
  const [wsDesc, setWsDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleCreate = () => {
    if (!wsName.trim()) return;
    const description = wsDesc.trim() || undefined;
    createMutation.mutate({ name: wsName.trim(), ...(description !== undefined ? { description } : {}) }, {
      onSuccess: () => { setCreateOpen(false); setWsName(''); setWsDesc(''); },
    });
  };

  if (orgLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (!org) {
    return (
      <div className="rounded-xl border border-border bg-muted/20 p-8 text-center space-y-3">
        <LayoutGrid className="h-10 w-10 mx-auto text-muted-foreground/40" />
        <p className="text-sm font-medium">No organization</p>
        <p className="text-sm text-muted-foreground">Create an organization first to manage workspaces.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Workspaces</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Workspaces let you group API keys and settings by project or environment.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" /> New workspace
        </Button>
      </div>

      {/* Workspace list */}
      {wsLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <div key={ws.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{ws.name}</p>
                    {ws.isDefault && (
                      <Badge variant="outline" className="text-[10px]">Default</Badge>
                    )}
                  </div>
                  {ws.description && <p className="text-xs text-muted-foreground truncate">{ws.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground hidden sm:block">
                  Created {format(new Date(ws.createdAt), 'MMM d, yyyy')}
                </span>
                {!ws.isDefault && (
                  <button
                    onClick={() => setDeleteTarget(ws.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}

          {workspaces.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-border p-10 text-center space-y-2">
              <LayoutGrid className="h-10 w-10 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            </div>
          )}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>Group your API keys by project or environment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Workspace name</Label>
              <Input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. Production" onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea value={wsDesc} onChange={(e) => setWsDesc(e.target.value)} placeholder="What is this workspace used for?" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!wsName.trim() || createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the workspace and all its API keys.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate(deleteTarget!, { onSuccess: () => setDeleteTarget(null) })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Manufacturing Knowledge Tab
// ─────────────────────────────────────────────────────────────
const KB_SUBTABS = ['feature-process', 'routing-rules', 'machines', 'templates', 'feedback'] as const;
type KbSubtab = typeof KB_SUBTABS[number];

const KB_SUBTAB_LABELS: Record<KbSubtab, string> = {
  'feature-process': 'Feature → Process',
  'routing-rules':   'Routing Rules',
  'machines':        'Machine Capabilities',
  'templates':       'Routing Templates',
  'feedback':        'Engineer Feedback',
};

function ManufacturingKnowledgeTab() {
  const [activeKbTab, setActiveKbTab] = useState<KbSubtab>('feature-process');
  const [addFpmOpen, setAddFpmOpen] = useState(false);
  const [addRuleOpen, setAddRuleOpen] = useState(false);
  const [addMachineOpen, setAddMachineOpen] = useState(false);

  const [fpmFeatureType, setFpmFeatureType] = useState('');
  const [fpmPrimaryProcess, setFpmPrimaryProcess] = useState('');
  const [fpmMachineType, setFpmMachineType] = useState('');
  const [fpmPrereq, setFpmPrereq] = useState('');

  const [ruleFirst, setRuleFirst] = useState('');
  const [ruleSecond, setRuleSecond] = useState('');
  const [ruleConstraint, setRuleConstraint] = useState<'must_precede' | 'must_follow' | 'cannot_coexist'>('must_precede');
  const [ruleSeverity, setRuleSeverity] = useState<'error' | 'warning'>('error');
  const [ruleMessage, setRuleMessage] = useState('');

  const [machineName, setMachineName] = useState('');
  const [machineType, setMachineType] = useState('');
  const [machineProcesses, setMachineProcesses] = useState('');

  const { data: fpmRows = [], isLoading: fpmLoading } = useFeatureProcessMappings();
  const { data: ruleRows = [], isLoading: rulesLoading } = useRoutingRules();
  const { data: machineRows = [], isLoading: machinesLoading } = useMachineCapabilities();
  const { data: templateRows = [], isLoading: templatesLoading } = useRoutingTemplates();

  const handleAddFpm = () => {
    if (!fpmFeatureType.trim() || !fpmPrimaryProcess.trim()) return;
    toast.success('Custom rule added (API integration required)');
    setAddFpmOpen(false);
    setFpmFeatureType(''); setFpmPrimaryProcess(''); setFpmMachineType(''); setFpmPrereq('');
  };

  const handleAddRule = () => {
    if (!ruleFirst.trim() || !ruleSecond.trim() || !ruleMessage.trim()) return;
    toast.success('Custom rule added (API integration required)');
    setAddRuleOpen(false);
    setRuleFirst(''); setRuleSecond(''); setRuleMessage('');
  };

  const handleAddMachine = () => {
    if (!machineName.trim() || !machineType.trim()) return;
    toast.success('Machine added (API integration required)');
    setAddMachineOpen(false);
    setMachineName(''); setMachineType(''); setMachineProcesses('');
  };

  return (
    <div className="space-y-6 w-full">
      <div>
        <h2 className="text-lg font-semibold">Manufacturing Knowledge</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ground-truth rules used by the AI process planner. System entries are read-only; add custom entries to extend or override.
        </p>
      </div>

      {/* Sub-tab nav */}
      <div className="flex gap-0.5 border-b border-border">
        {KB_SUBTABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveKbTab(tab)}
            className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
              activeKbTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {KB_SUBTAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Feature → Process */}
      {activeKbTab === 'feature-process' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Maps each feature type (hole, pocket, bend…) to its primary process and machine.</p>
            <Button size="sm" variant="outline" onClick={() => setAddFpmOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Custom Rule
            </Button>
          </div>
          {fpmLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[140px_130px_110px_120px_1fr] border-b border-border bg-muted/40 px-3 py-2">
                {['Feature Type', 'Primary Process', 'Machine', 'Prerequisite', 'Notes'].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                ))}
              </div>
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {fpmRows.map((row: FeatureProcessMapping) => (
                  <div key={row.id} className="grid grid-cols-[140px_130px_110px_120px_1fr] px-3 py-2 items-center text-xs">
                    <span className="font-mono font-medium text-foreground">{row.featureType}</span>
                    <span className="text-foreground">{row.primaryProcess}</span>
                    <span className="text-muted-foreground">{row.typicalMachineType ?? '—'}</span>
                    <span className="text-muted-foreground">{row.prerequisiteProcess ?? '—'}</span>
                    <span className="truncate text-muted-foreground">{row.notes ?? '—'}</span>
                  </div>
                ))}
                {fpmRows.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-6 text-center">No entries yet. Run the database migration to seed system data.</p>
                )}
              </div>
            </div>
          )}
          <Dialog open={addFpmOpen} onOpenChange={setAddFpmOpen}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle>Add Custom Feature → Process Rule</DialogTitle>
                <DialogDescription>Override or extend the system defaults for your shop floor.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5"><Label>Feature type</Label><Input value={fpmFeatureType} onChange={(e) => setFpmFeatureType(e.target.value)} placeholder="e.g. hole, pocket, bend" /></div>
                <div className="space-y-1.5"><Label>Primary process</Label><Input value={fpmPrimaryProcess} onChange={(e) => setFpmPrimaryProcess(e.target.value)} placeholder="e.g. drilling, end_milling" /></div>
                <div className="space-y-1.5"><Label>Typical machine type</Label><Input value={fpmMachineType} onChange={(e) => setFpmMachineType(e.target.value)} placeholder="e.g. vmc, lathe, laser" /></div>
                <div className="space-y-1.5"><Label>Prerequisite process <span className="text-muted-foreground">(optional)</span></Label><Input value={fpmPrereq} onChange={(e) => setFpmPrereq(e.target.value)} placeholder="e.g. drilling (must run first)" /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setAddFpmOpen(false)}>Cancel</Button>
                <Button onClick={handleAddFpm} disabled={!fpmFeatureType.trim() || !fpmPrimaryProcess.trim()}>Add Rule</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Routing Rules */}
      {activeKbTab === 'routing-rules' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Sequence validation rules — must_precede, must_follow, cannot_coexist.</p>
            <Button size="sm" variant="outline" onClick={() => setAddRuleOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Rule
            </Button>
          </div>
          {rulesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[130px_130px_130px_80px_1fr] border-b border-border bg-muted/40 px-3 py-2">
                {['First Process', 'Second Process', 'Constraint', 'Severity', 'Message'].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                ))}
              </div>
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {ruleRows.map((row: ProcessRoutingRule) => (
                  <div key={row.id} className="grid grid-cols-[130px_130px_130px_80px_1fr] px-3 py-2 items-center text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">{row.firstProcess}</span>
                    <span className="font-mono text-foreground">{row.secondProcess}</span>
                    <span className="font-mono">{row.constraintType}</span>
                    <span className={row.severity === 'error' ? 'text-red-400 font-medium' : 'text-amber-400 font-medium'}>{row.severity}</span>
                    <span className="truncate">{row.message}</span>
                  </div>
                ))}
                {ruleRows.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-6 text-center">No rules yet. Run the database migration to seed system rules.</p>
                )}
              </div>
            </div>
          )}
          <Dialog open={addRuleOpen} onOpenChange={setAddRuleOpen}>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader>
                <DialogTitle>Add Custom Routing Rule</DialogTitle>
                <DialogDescription>Define sequencing constraints for your process routes.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>First process</Label><Input value={ruleFirst} onChange={(e) => setRuleFirst(e.target.value)} placeholder="e.g. drilling" /></div>
                  <div className="space-y-1.5"><Label>Second process</Label><Input value={ruleSecond} onChange={(e) => setRuleSecond(e.target.value)} placeholder="e.g. tapping" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Constraint</Label>
                    <Select value={ruleConstraint} onValueChange={(v) => setRuleConstraint(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="must_precede">must_precede</SelectItem>
                        <SelectItem value="must_follow">must_follow</SelectItem>
                        <SelectItem value="cannot_coexist">cannot_coexist</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Severity</Label>
                    <Select value={ruleSeverity} onValueChange={(v) => setRuleSeverity(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="error">error</SelectItem>
                        <SelectItem value="warning">warning</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5"><Label>Message</Label><Input value={ruleMessage} onChange={(e) => setRuleMessage(e.target.value)} placeholder="Human-readable description of the rule" /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setAddRuleOpen(false)}>Cancel</Button>
                <Button onClick={handleAddRule} disabled={!ruleFirst.trim() || !ruleSecond.trim() || !ruleMessage.trim()}>Add Rule</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Machine Capabilities */}
      {activeKbTab === 'machines' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Machine type → supported processes, tolerances, material compatibility.</p>
            <Button size="sm" variant="outline" onClick={() => setAddMachineOpen(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Machine
            </Button>
          </div>
          {machinesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[160px_120px_1fr] border-b border-border bg-muted/40 px-3 py-2">
                {['Machine Name', 'Type', 'Supported Processes'].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</span>
                ))}
              </div>
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {machineRows.map((row: MachineCapability) => (
                  <div key={row.id} className="grid grid-cols-[160px_120px_1fr] px-3 py-2 items-center text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{row.machineName}</span>
                    <span className="font-mono">{row.machineType}</span>
                    <span className="truncate">{(row.supportedProcesses ?? []).join(', ')}</span>
                  </div>
                ))}
                {machineRows.length === 0 && (
                  <p className="text-xs text-muted-foreground px-3 py-6 text-center">No machines configured. Add your shop floor machines to improve AI machine selection.</p>
                )}
              </div>
            </div>
          )}
          <Dialog open={addMachineOpen} onOpenChange={setAddMachineOpen}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle>Add Machine</DialogTitle>
                <DialogDescription>Define what processes this machine can perform.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5"><Label>Machine name</Label><Input value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="e.g. Haas VF-2" /></div>
                <div className="space-y-1.5"><Label>Machine type</Label><Input value={machineType} onChange={(e) => setMachineType(e.target.value)} placeholder="e.g. vmc, lathe, grinder" /></div>
                <div className="space-y-1.5">
                  <Label>Supported processes <span className="text-muted-foreground">(comma-separated)</span></Label>
                  <Input value={machineProcesses} onChange={(e) => setMachineProcesses(e.target.value)} placeholder="e.g. drilling, milling, tapping" />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setAddMachineOpen(false)}>Cancel</Button>
                <Button onClick={handleAddMachine} disabled={!machineName.trim() || !machineType.trim()}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* Routing Templates */}
      {activeKbTab === 'templates' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">Standard process sequences per part family. The AI uses these as the base route before injecting feature-specific operations.</p>
          {templatesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-3">
              {(templateRows as PartFamilyRoutingTemplate[]).map((t) => (
                <div key={t.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold">{t.templateName}</span>
                      <span className="ml-2 text-xs text-muted-foreground font-mono">{t.partFamily}</span>
                    </div>
                    {t.complexityLevel && <Badge variant="outline" className="text-[10px]">{t.complexityLevel}</Badge>}
                  </div>
                  {Array.isArray(t.routingSequence) && (
                    <div className="space-y-0.5">
                      {t.routingSequence.map((step: any) => (
                        <div key={step.step} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="w-6 text-right font-mono text-foreground/60">{step.step}</span>
                          <span className="font-mono text-primary/80">{step.process}</span>
                          <span className="text-muted-foreground/60">[{step.machineType}]</span>
                          <span>{step.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {templateRows.length === 0 && (
                <div className="rounded-xl border-2 border-dashed border-border p-10 text-center">
                  <p className="text-sm text-muted-foreground">No templates found. Run the database migration to seed routing templates.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Engineer Feedback */}
      {activeKbTab === 'feedback' && (
        <FeedbackSubtab />
      )}
    </div>
  );
}

function FeedbackSubtab() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Engineer corrections to AI-generated process plans. Used to improve future generation quality.</p>
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <p className="text-sm font-medium">How to submit feedback</p>
        <ol className="space-y-1.5 text-sm text-muted-foreground list-decimal list-inside">
          <li>Navigate to a BOM item and open the AI Process Plan panel</li>
          <li>If the AI generated incorrect machine assignments or wrong process order, click "Submit Correction"</li>
          <li>Enter the correct sequence and the reason for the correction</li>
          <li>Corrections are stored in the <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">process_plan_feedback</code> table and used to improve future generations</li>
        </ol>
        <div className="rounded-lg border border-border bg-muted/30 p-3 mt-2">
          <p className="text-xs text-muted-foreground">Per-part feedback history is viewable from the process plan panel on each BOM item page. A global feedback dashboard will be added in V2.</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings Page — vertical sidebar layout
// ─────────────────────────────────────────────────────────────
const VALID_TABS = ['profile', 'preferences', 'organization', 'workspaces', 'api-keys', 'portal', 'logs', 'manufacturing-knowledge'] as const;
type Tab = typeof VALID_TABS[number];

const NAV_SECTIONS = [
  {
    label: 'Account',
    items: [
      { id: 'profile'      as Tab, label: 'Profile' },
      { id: 'preferences'  as Tab, label: 'Preferences' },
    ],
  },
  {
    label: 'Organization settings',
    items: [
      { id: 'organization' as Tab, label: 'Organization' },
      { id: 'workspaces'   as Tab, label: 'Workspaces' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { id: 'api-keys'     as Tab, label: 'API Keys' },
      { id: 'portal'       as Tab, label: 'Developer Portal' },
      { id: 'logs'         as Tab, label: 'Request Logs' },
    ],
  },
  {
    label: 'Manufacturing',
    items: [
      { id: 'manufacturing-knowledge' as Tab, label: 'Knowledge Base' },
    ],
  },
];

const TAB_TITLES: Record<Tab, string> = {
  'profile':                  'Profile',
  'preferences':              'Preferences',
  'organization':             'Organization',
  'workspaces':               'Workspaces',
  'api-keys':                 'API Keys',
  'portal':                   'Developer Portal',
  'logs':                     'Request Logs',
  'manufacturing-knowledge':  'Manufacturing Knowledge',
};

function SettingsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get('tab') ?? 'profile';
  const activeTab: Tab = (VALID_TABS as readonly string[]).includes(raw) ? raw as Tab : 'profile';

  const navigate = (tab: Tab) => {
    router.push(tab === 'profile' ? '/settings' : `/settings?tab=${tab}`, { scroll: false });
  };

  const content: Record<Tab, React.ReactNode> = {
    'profile':                  <ProfileTab />,
    'preferences':              <PreferencesTab />,
    'organization':             <OrganizationTab />,
    'workspaces':               <WorkspacesTab />,
    'api-keys':                 <ApiKeysTab />,
    'portal':                   <DeveloperPortalTab />,
    'logs':                     <RequestLogsTab />,
    'manufacturing-knowledge':  <ManufacturingKnowledgeTab />,
  };

  return (
    <div className="animate-fade-in flex gap-0 min-h-full">
      {/* ── Left vertical nav ── */}
      <aside className="w-52 shrink-0 pr-6 border-r border-border">
        <div className="sticky top-0 space-y-6 pt-1">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-foreground/50 mb-2 px-3">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => navigate(item.id)}
                        className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-sidebar-accent text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* ── Right content ── */}
      <main className="flex-1 min-w-0 pl-8">
        <h1 className="text-2xl font-bold mb-6">{TAB_TITLES[activeTab]}</h1>
        {content[activeTab]}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <SettingsInner />
    </Suspense>
  );
}
