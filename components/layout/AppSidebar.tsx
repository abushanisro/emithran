'use client';

import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  LogOut,
  Database,
  Calculator,
  Table,
  Sigma,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const databaseItems = [
  { title: 'Vendors', url: '/vendors', icon: Users },
  { title: 'Raw Materials', url: '/raw-materials', icon: Database },
  { title: 'MHR', url: '/mhr-database', icon: Calculator },
  { title: 'LHR', url: '/lhr-database', icon: Users },
  { title: 'Calculators', url: '/calculators', icon: Sigma },
  { title: 'Process', url: '/process', icon: Table },
];

// Materials module not yet implemented in backend - will be added in future release

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      // Logout error occurred
    }
  };

  const isActive = (path: string) => {
    if (!pathname) return false;
    if (path === '/') return pathname === '/';
    return pathname.startsWith(path);
  };

  // Helper function to get display name from user data
  const getUserDisplayName = () => {
    const fullName = (user as any)?.user_metadata?.full_name;
    if (fullName) return fullName;
    
    // Extract name from email if no full name available
    if (user?.email) {
      const emailPrefix = user.email.split('@')[0];
      // Convert email prefix to readable name (e.g., "john.doe" -> "John Doe")
      return emailPrefix
        .split(/[._-]/) // Split on dots, underscores, or hyphens
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
    }
    
    return 'User';
  };

  const userInitials = (user as any)?.user_metadata?.full_name
    ?.split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U';

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-lg text-sidebar-foreground tracking-tight">mithran</h2>
              <p className="text-xs text-sidebar-foreground/50">One-Stop Solution</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <Separator className="bg-sidebar-border/50" />

      <SidebarContent className="px-3 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[11px] uppercase tracking-widest font-medium px-3 mb-2">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Dashboard - Regular Link */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive('/')}>
                  <NavLink
                    to="/"
                    end
                    className={`sidebar-item group ${isActive('/') && pathname === '/' ? 'sidebar-item-active' : ''}`}
                    activeClassName="sidebar-item-active"
                  >
                    <LayoutDashboard className={`h-4 w-4 shrink-0 transition-colors ${isActive('/') && pathname === '/' ? 'text-primary' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'}`} />
                    {!collapsed && <span className="text-sm">Dashboard</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Projects - Simple Link */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive('/projects')}>
                  <NavLink
                    to="/projects"
                    className={`sidebar-item group ${isActive('/projects') ? 'sidebar-item-active' : ''}`}
                    activeClassName="sidebar-item-active"
                  >
                    <FolderKanban className={`h-4 w-4 shrink-0 transition-colors ${isActive('/projects') ? 'text-primary' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'}`} />
                    {!collapsed && <span className="text-sm">Projects</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-sidebar-foreground/40 text-[11px] uppercase tracking-widest font-medium px-3 mb-2">
            Database
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {databaseItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink
                      to={item.url}
                      className={`sidebar-item group ${isActive(item.url) ? 'sidebar-item-active' : ''}`}
                      activeClassName="sidebar-item-active"
                    >
                      <item.icon className={`h-4 w-4 shrink-0 transition-colors ${isActive(item.url) ? 'text-primary' : 'text-sidebar-foreground/60 group-hover:text-sidebar-foreground'}`} />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <Avatar className="h-9 w-9 shrink-0 border border-sidebar-border">
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {getUserDisplayName()}
              </p>
              <p className="text-xs text-sidebar-foreground/50 truncate">
                {user?.email}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            type="button"
            className="h-8 w-8 text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10 shrink-0"
            onClick={handleSignOut}
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
