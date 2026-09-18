'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/providers/auth';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Loader2, Menu, Bell, Search, Settings, Building2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MithranAICreditsBar } from './MithranAICreditsBar';
import { useProfile } from '@/lib/api/hooks/useProfile';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, signOut } = useAuth();
  const { data: profile } = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const isFullscreen = pathname?.includes('/manufacturing-intelligence');
  const [shouldRedirect, setShouldRedirect] = useState(false);

  useEffect(() => {
    // Only redirect after auth has fully loaded and there's definitively no user
    if (!loading && !user) {
      // Store current URL for redirect after auth
      const currentUrl = window.location.pathname + window.location.search;
      if (currentUrl !== '/auth' && currentUrl !== '/') {
        sessionStorage.setItem('redirectAfterAuth', currentUrl);
      }

      // Add a small delay to prevent flashing during normal auth resolution
      const timer = setTimeout(() => {
        setShouldRedirect(true);
        router.replace('/auth');
      }, 100);

      return () => clearTimeout(timer);
    } else if (user) {
      setShouldRedirect(false);

      // Check for stored redirect URL and navigate there
      const redirectUrl = sessionStorage.getItem('redirectAfterAuth');
      if (redirectUrl && window.location.pathname === '/') {
        sessionStorage.removeItem('redirectAfterAuth');
        router.replace(redirectUrl);
      }
    }

    return undefined;
  }, [user, loading, router]);

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

  // Show loading during auth resolution or when about to redirect
  if (loading || (!user && !shouldRedirect)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If we're redirecting, show loading state
  if (shouldRedirect || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full max-w-full bg-background overflow-x-hidden">
        <AppSidebar />
        <SidebarInset className="flex-1 flex flex-col">
          {isFullscreen ? children : (
            <>
              <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 sticky top-0 z-10">
                <div className="flex items-center gap-4">
                  <SidebarTrigger className="text-muted-foreground hover:text-foreground transition-colors">
                    <Menu className="h-5 w-5" />
                  </SidebarTrigger>

                  <div className="hidden md:flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-1.5 w-64">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search projects, vendors..."
                      className="border-0 bg-transparent h-7 p-0 focus-visible:ring-0 text-sm placeholder:text-muted-foreground/60"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative">
                    <Bell className="h-5 w-5" />
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-primary rounded-full"></span>
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center gap-1.5 rounded-full pl-1 pr-1 py-1 hover:bg-secondary/60 transition-colors outline-none">
                        <Avatar className="h-7 w-7 border border-border">
                          <AvatarImage src={profile?.avatarUrl ?? undefined} alt={getUserDisplayName()} />
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                            {userInitials}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent
                      align="end"
                      sideOffset={8}
                      className="w-60 rounded-xl border border-border bg-popover shadow-xl shadow-black/15 p-1"
                    >
                      <DropdownMenuLabel className="px-3 py-2 font-normal">
                        <p className="text-sm font-medium text-foreground truncate leading-tight">{getUserDisplayName()}</p>
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
                        onSelect={() => router.push('/settings?tab=organization')}
                      >
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        Organization
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
                </div>
              </header>
              <MithranAICreditsBar />
              <main className="flex-1 min-w-0 p-4 sm:p-6 overflow-auto overflow-x-hidden">
                {children}
              </main>
            </>
          )}
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
