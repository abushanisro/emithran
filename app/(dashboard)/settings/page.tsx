'use client';

import { format } from 'date-fns';
import { useSearchParams, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, useRef, useEffect, Suspense } from 'react';
import { toast } from 'sonner';

import { CopilotMemorySection } from '@/components/features/settings/CopilotMemorySection';
import { PageHeader } from '@/components/layout/PageHeader';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Plus, Copy, Check,
  Camera, Loader2,
  Monitor, Sun, Moon, Building2, Trash2,
  LayoutGrid, Mail, X,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  useMyOrganization, useCreateOrganization, useUpdateOrganization,
  useDeleteOrganization, useOrgMembers, useInviteMember, useRemoveMember,
  useWorkspaces, useCreateWorkspace, useDeleteWorkspace,
} from '@/lib/api/hooks/useOrganization';
import { useProfile, useUpdateProfile, useUploadAvatar } from '@/lib/api/hooks/useProfile';
import { useAuth } from '@/lib/providers/auth';
import { useDensity } from '@/lib/providers/density-provider';

const TIMEZONES = [
  'UTC', 'Asia/Kolkata', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Los_Angeles',
];

// ─────────────────────────────────────────────────────────────
// Preferences Tab
// ─────────────────────────────────────────────────────────────

type ColorMode = 'light' | 'brand' | 'dark';

/** A miniature of the app in one theme: sidebar with the teal active item, a heading, two lines and a card. Colours are the theme's tokens (app/globals.css). */
function ThemePreview({ c }: { c: { bg: string; sidebar: string; border: string; teal: string; ink: string; line: string; card: string } }) {
  return (
    <div className="w-full h-full rounded-md overflow-hidden flex" style={{ background: c.bg, border: `1px solid ${c.border}` }}>
      <div className="w-[28%] p-1.5 flex flex-col gap-1" style={{ background: c.sidebar, borderRight: `1px solid ${c.border}` }}>
        <div className="h-1.5 w-8 rounded-full" style={{ background: c.teal }} />
        <div className="h-1 w-6 rounded-full mt-1" style={{ background: c.line }} />
        <div className="h-1 w-6 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-5 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex-1 p-1.5 flex flex-col gap-1">
        <div className="h-1.5 w-12 rounded-full" style={{ background: c.ink }} />
        <div className="h-1 w-full rounded-full mt-1" style={{ background: c.line }} />
        <div className="h-1 w-4/5 rounded-full" style={{ background: c.line }} />
        <div className="h-4 w-full rounded mt-1" style={{ background: c.card, border: `1px solid ${c.border}` }} />
      </div>
    </div>
  );
}

const COLOR_MODES: { value: ColorMode; label: string; icon: React.FC<{ className?: string }>; preview: React.ReactNode }[] = [
  {
    value: 'light',
    label: 'Light',
    icon: Sun,
    preview: <ThemePreview c={{ bg: '#f8fafc', sidebar: '#ffffff', border: '#cbd5e1', teal: '#0d9488', ink: '#0f1b2d', line: '#e2e8f0', card: '#ffffff' }} />,
  },
  {
    value: 'brand',
    label: 'Navy',
    icon: Monitor,
    preview: <ThemePreview c={{ bg: '#081120', sidebar: '#06180f', border: '#22324a', teal: '#2dd4bf', ink: '#e2e8f0', line: '#22324a', card: '#0f1b2d' }} />,
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: Moon,
    preview: <ThemePreview c={{ bg: '#080808', sidebar: '#0a0a0a', border: '#242424', teal: '#2dd4bf', ink: '#e5e5e5', line: '#242424', card: '#111111' }} />,
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
            Customize how EMITHRAN looks on your device.
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
                  className={`group relative flex flex-col gap-3 rounded-lg border-2 p-3 text-left transition-all duration-150 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 ${
                    active
                      ? 'border-primary bg-primary/5 shadow-[0_0_0_3px] shadow-primary/10'
                      : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30'
                  }`}
                >
                  {/* Preview thumbnail */}
                  <div className="aspect-video w-full rounded-lg overflow-hidden shadow-xs ring-1 ring-border/50">
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
                className={`group flex flex-col gap-3 rounded-lg border-2 p-3 text-left transition-all duration-150 outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50 ${
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

      <div className="h-px bg-border" />

      <CopilotMemorySection />

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
  const avatarMutation = useUploadAvatar();

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
    if (!file) return;
    setAvatarUploading(true);
    try {
      await avatarMutation.mutateAsync(file);
      toast.success('Photo updated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Avatar upload failed');
    } finally {
      setAvatarUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <ListSkeleton rows={4} label="Loading…" className="py-10" />
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
                type="button"
                aria-label="Upload profile photo"
                onClick={() => fileRef.current?.click()}
                disabled={avatarUploading}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                {avatarUploading
                  ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                  : <Camera className="h-5 w-5 text-white" aria-hidden="true" />}
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarChange} />
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
              <div key={label} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
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
    return <ListSkeleton rows={4} label="Loading…" className="py-10" />;
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
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-12 text-center">
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
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">

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
                    ? <><Check className="h-3.5 w-3.5 text-success" /><span className="text-success">Copied</span></>
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
                  {copied ? <><Check className="h-3.5 w-3.5 text-success" /><span className="text-success">Copied</span></> : <><Copy className="h-3.5 w-3.5" /><span>Copy</span></>}
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
      <div className="rounded-lg border border-border bg-card p-5 flex items-center justify-between gap-6">
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

        <div className="rounded-lg border border-border overflow-hidden">
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
                  <span className={`text-xs font-medium capitalize ${m.status === 'active' ? 'text-success' : 'text-warning'}`}>
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
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
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

  if (orgLoading) return <ListSkeleton rows={4} label="Loading…" className="py-10" />;

  if (!org) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-8 text-center space-y-3">
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
            <div key={ws.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
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
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center space-y-2">
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
// Settings Page — vertical sidebar layout
// ─────────────────────────────────────────────────────────────
const VALID_TABS = ['profile', 'preferences', 'organization', 'workspaces'] as const;
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
];

const TAB_TITLES: Record<Tab, string> = {
  'profile':                  'Profile',
  'preferences':              'Preferences',
  'organization':             'Organization',
  'workspaces':               'Workspaces',
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
  };

  return (
    <div className="animate-fade-in flex min-h-full flex-col gap-6 md:flex-row md:gap-0">
      {/* ── Section navigation ── */}
      <aside className="shrink-0 border-b border-border pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-6">
        <nav aria-label="Settings sections" className="space-y-6 pt-1 md:sticky md:top-0">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = activeTab === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate(item.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? 'border-primary bg-sidebar-accent font-medium text-foreground'
                            : 'border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
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
        </nav>
      </aside>

      {/* ── Content ── */}
      <main className="min-w-0 flex-1 md:pl-8">
        <PageHeader title={TAB_TITLES[activeTab]} />
        {content[activeTab]}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={4} label="Loading…" className="py-10" />}>
      <SettingsInner />
    </Suspense>
  );
}
