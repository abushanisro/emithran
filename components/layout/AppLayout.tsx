'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/providers/auth';
import { SidebarProvider, SidebarTrigger, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Loader2, Menu, Bell, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
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
  }, [user, loading, router]);

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
            
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground relative">
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-primary rounded-full"></span>
              </Button>
            </div>
          </header>
          <main className="flex-1 p-6 overflow-auto">
            {children}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
