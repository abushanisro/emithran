'use client';

import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';

import { EmithranMark } from '@/components/brand/EmithranLogo';
import { NavLink } from '@/components/common/nav-link';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DuoBuilding,
  DuoCalculator,
  DuoCompare,
  DuoDashboard,
  DuoDatabase,
  DuoGrid,
  DuoHelp,
  DuoInfo,
  DuoLightbulb,
  DuoLogOut,
  DuoPreferences,
  DuoProjects,
  DuoSettings,
  DuoSigma,
  DuoTable,
  DuoUsers,
} from '@/components/ui/duotone-icons';
import { ChevronsUpDown } from '@/components/ui/icons';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useProfile } from '@/lib/api/hooks/useProfile';
import { useAuth } from '@/lib/providers/auth';


// ─── nav config ──────────────────────────────────────────────
type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Work',
    items: [
      { title: 'Dashboard', url: '/', icon: DuoDashboard, exact: true },
      { title: 'Projects', url: '/projects', icon: DuoProjects },
    ],
  },
  {
    label: 'Insights',
    items: [
      { title: 'Benchmarking', url: '/benchmarks', icon: DuoCompare },
      { title: 'VAVE', url: '/vave', icon: DuoLightbulb },
    ],
  },
  {
    label: 'Master Data',
    items: [
      { title: 'Vendors', url: '/vendors', icon: DuoUsers },
      { title: 'Raw Materials', url: '/raw-materials', icon: DuoDatabase },
      { title: 'HR Rates', url: '/hr-rates', icon: DuoCalculator },
      { title: 'Process', url: '/process', icon: DuoTable },
      { title: 'Calculators', url: '/calculators', icon: DuoSigma },
    ],
  },
];

// ─────────────────────────────────────────────────────────────
export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile();
  const router = useRouter();

  const isActive = (url: string, exact = false) => {
    if (!pathname) return false;
    if (exact || url === '/') return pathname === url;
    return pathname.startsWith(url);
  };

  const getUserDisplayName = () => {
    const full = profile?.displayName || (user as any)?.user_metadata?.full_name;
    if (full) return full;
    if (user?.email) {
      const prefix = user.email.split('@')[0] ?? '';
      return prefix
        .split(/[._-]/)
        .map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(' ');
    }
    return 'User';
  };

  const userInitials =
    (profile?.displayName || (user as any)?.user_metadata?.full_name)
      ?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    || user?.email?.[0]?.toUpperCase()
    || 'U';

  const navItem = (item: NavItem) => {
    const active = isActive(item.url, item.exact);
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton
          asChild
          isActive={active}
          tooltip={item.title}
          className="data-[active=true]:[&>svg]:text-primary"
        >
          <NavLink to={item.url} end={!!item.exact}>
            <item.icon />
            <span>{item.title}</span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              className="cursor-default hover:bg-transparent active:bg-transparent"
            >
              <div>
                <div className="flex aspect-square size-8 shrink-0 items-center justify-center text-sidebar-foreground">
                  <EmithranMark className="h-7" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">EMITHRAN</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Manufacturing intelligence</span>
                </div>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{group.items.map(navItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* ── Profile footer with account dropdown ── */}
      <SidebarFooter>
        <SidebarMenu>
        <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={String(getUserDisplayName())}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 shrink-0 rounded-lg border border-sidebar-border">
                <AvatarImage src={profile?.avatarUrl ?? undefined} alt={getUserDisplayName()} />
                <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-sm font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium text-sidebar-foreground">
                  {getUserDisplayName()}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/60">{user?.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={collapsed ? 'right' : 'top'}
            align={collapsed ? 'end' : 'start'}
            sideOffset={8}
            className="w-64 rounded-xl border border-border bg-popover shadow-xl shadow-black/15 p-1"
          >
            {/* User email header */}
            <DropdownMenuLabel className="px-3 py-2 font-normal">
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings')}
            >
              <DuoSettings className="h-4 w-4 text-muted-foreground" />
              Settings
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=preferences')}
            >
              <DuoPreferences className="h-4 w-4 text-muted-foreground" />
              Preferences
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=organization')}
            >
              <DuoBuilding className="h-4 w-4 text-muted-foreground" />
              Organization
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=workspaces')}
            >
              <DuoGrid className="h-4 w-4 text-muted-foreground" />
              Workspaces
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => window.open('mailto:support@mithran.dev', '_blank')}
            >
              <DuoHelp className="h-4 w-4 text-muted-foreground" />
              Get help
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => window.open('/docs', '_blank')}
            >
              <DuoInfo className="h-4 w-4 text-muted-foreground" />
              Learn more
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => signOut().catch(() => {})}
            >
              <DuoLogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
