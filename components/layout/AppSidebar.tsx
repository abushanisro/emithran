'use client';

import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Database,
  Calculator,
  Table,
  Sigma,
  GitCompare,
  Lightbulb,
  Settings,
  SlidersHorizontal,
  Key,
  Building2,
  LayoutGrid,
  HelpCircle,
  Info,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { NavLink } from '@/components/common/nav-link';
import { useAuth } from '@/lib/providers/auth';
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
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useProfile } from '@/lib/api/hooks/useProfile';
import { Separator } from '@/components/ui/separator';
import { useRouter } from 'next/navigation';

// ─── nav config ──────────────────────────────────────────────
const mainItems = [
  { title: 'Dashboard',    url: '/',           icon: LayoutDashboard, exact: true },
  { title: 'Projects',     url: '/projects',   icon: FolderKanban },
  { title: 'Benchmarking', url: '/benchmarks', icon: GitCompare },
  { title: 'VAVE',         url: '/vave',       icon: Lightbulb },
];

const databaseItems = [
  { title: 'Vendors',       url: '/vendors',       icon: Users },
  { title: 'Raw Materials', url: '/raw-materials', icon: Database },
  { title: 'HR Rates',       url: '/hr-rates',      icon: Calculator },
  { title: 'Calculators',   url: '/calculators',   icon: Sigma },
  { title: 'Process',       url: '/process',       icon: Table },
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

  const navItem = (item: { title: string; url: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton asChild isActive={isActive(item.url, item.exact)}>
        <NavLink
          to={item.url}
          end={!!item.exact}
          className={`sidebar-item group ${isActive(item.url, item.exact) ? 'sidebar-item-active' : ''}`}
          activeClassName="sidebar-item-active"
        >
          <item.icon className={`h-4 w-4 shrink-0 transition-colors ${
            isActive(item.url, item.exact)
              ? 'text-primary'
              : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'
          }`} />
          {!collapsed && <span className="text-sm">{item.title}</span>}
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="p-4">
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-lg text-sidebar-foreground tracking-tight">mithran</h2>
            <p className="text-xs text-sidebar-foreground/50">One-Stop Solution</p>
          </div>
        )}
      </SidebarHeader>

      <Separator className="bg-sidebar-border/50" />

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/70 text-[11px] uppercase tracking-widest font-medium px-3 mb-2">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{mainItems.map(navItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-sidebar-foreground/70 text-[11px] uppercase tracking-widest font-medium px-3 mb-2">
            Database
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{databaseItems.map(navItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Profile footer with Claude-style dropdown ── */}
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 hover:bg-sidebar-accent transition-colors outline-none">
              <Avatar className="h-8 w-8 shrink-0 border border-sidebar-border">
                <AvatarImage src={profile?.avatarUrl ?? undefined} alt={getUserDisplayName()} />
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-sidebar-foreground truncate leading-tight">
                      {getUserDisplayName()}
                    </p>
                    <p className="text-xs text-sidebar-foreground/50 truncate leading-tight">
                      {user?.email}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-sidebar-foreground/30 shrink-0" />
                </>
              )}
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side="top"
            align="start"
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
              <Settings className="h-4 w-4 text-muted-foreground" />
              Settings
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=preferences')}
            >
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              Preferences
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=organization')}
            >
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Organization
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=workspaces')}
            >
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              Workspaces
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => router.push('/settings?tab=api-keys')}
            >
              <Key className="h-4 w-4 text-muted-foreground" />
              API Keys
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => window.open('mailto:support@mithran.dev', '_blank')}
            >
              <HelpCircle className="h-4 w-4 text-muted-foreground" />
              Get help
            </DropdownMenuItem>

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer"
              onSelect={() => window.open('/docs', '_blank')}
            >
              <Info className="h-4 w-4 text-muted-foreground" />
              Learn more
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
              onSelect={() => signOut().catch(() => {})}
            >
              <LogOut className="h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
