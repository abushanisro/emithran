'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchModal } from './SearchModal';
import type { ApiSpec } from '@/lib/docs/api-spec-types';

interface DocsNavbarProps {
  spec: ApiSpec;
}

export function DocsNavbar({ spec }: DocsNavbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex h-14 items-center gap-4 px-6">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            <div className="h-7 w-7 rounded-md bg-primary/20 flex items-center justify-center">
              <Code2 className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-bold text-foreground text-sm">mithran</span>
              <span className="text-xs text-muted-foreground font-medium">API</span>
            </div>
          </Link>

          <div className="h-4 w-px bg-border/60" />

          {/* Nav links */}
          <nav className="hidden md:flex items-center gap-1">
            <Link
              href="/developer"
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors"
            >
              Overview
            </Link>
            <Link
              href="/developer/api-reference"
              className="px-3 py-1.5 text-sm text-foreground font-medium rounded-md bg-muted/50 transition-colors"
            >
              API Reference
            </Link>
          </nav>

          <div className="flex-1" />

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden sm:flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors w-48"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 text-left text-xs">Search endpoints...</span>
            <kbd className="hidden lg:flex items-center gap-0.5 text-[10px] bg-background border border-border rounded px-1 py-0.5">
              <span>⌘</span>K
            </kbd>
          </button>

          <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>

          <div className="hidden md:flex items-center gap-2">
            <Link href="/portal" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="h-3.5 w-3.5" />
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} spec={spec} />
    </>
  );
}
