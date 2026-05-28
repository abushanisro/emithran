'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/providers/auth';
import { useBenchmarkSessions } from '@/lib/api/hooks/useBenchmarkSessions';
import { useVaveProjects } from '@/lib/api/hooks/useVave';
import { useProjects } from '@/lib/api/hooks/useProjects';
import type { BenchmarkSession } from '@/lib/api/benchmark-sessions';

// ─── Org name from email domain ────────────────────────────────────────────────

const CC_SLDS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu']);

function orgFromEmail(email: string): string {
  const domain = email.split('@')[1] ?? '';
  const parts  = domain.split('.');
  const sld    = parts[parts.length - 2] ?? '';
  const company = (
    parts.length >= 3 && CC_SLDS.has(sld)
      ? parts[parts.length - 3]
      : sld || parts[0]
  ) ?? '';
  return company.charAt(0).toUpperCase() + company.slice(1);
}

// ─── Credit weights per action ────────────────────────────────────────────────

const CR_PER_SESSION  = 150;
const CR_PER_VAVE     = 200;
const CR_PER_PROJECT  = 50;
const CR_PER_BOM      = 10;
const PLAN_CREDITS    = 10_000;

// ─── Component ─────────────────────────────────────────────────────────────────

export function MithranAICreditsBar() {
  const [expanded, setExpanded] = useState(false);
  const { user } = useAuth();

  const orgName = user
    ? (user.user_metadata?.organization as string | undefined) ??
      (user.user_metadata?.org_name    as string | undefined) ??
      orgFromEmail(user.email ?? '')
    : '—';

  // ── Real data ────────────────────────────────────────────────────────────────
  const { data: sessionsRaw }  = useBenchmarkSessions();
  const { data: vaveRaw }      = useVaveProjects();
  const { data: projectsData } = useProjects();

  const sessions     = (sessionsRaw  as BenchmarkSession[] | undefined) ?? [];
  const vaveProjects = (vaveRaw      as any[] | undefined) ?? [];
  const projects     = (projectsData as any)?.projects ?? [];

  // ── Derived numbers ──────────────────────────────────────────────────────────
  const totalBoms     = sessions.reduce((s, x) => s + (x.bomCount ?? 0), 0);
  const totalSavingsL = vaveProjects.reduce((s: number, p: any) => s + Number(p.totalSavings ?? 0), 0) / 100_000;

  const crBenchmark = sessions.length     * CR_PER_SESSION;
  const crVave      = vaveProjects.length * CR_PER_VAVE;
  const crProjects  = projects.length     * CR_PER_PROJECT;
  const crBom       = totalBoms           * CR_PER_BOM;
  const usedCredits = crBenchmark + crVave + crProjects + crBom;
  const pct         = Math.min(Math.round((usedCredits / PLAN_CREDITS) * 100), 100);
  const remaining   = Math.max(PLAN_CREDITS - usedCredits, 0);

  // ── Breakdown rows ───────────────────────────────────────────────────────────
  const breakdown = [
    { label: 'Benchmark Analysis',  credits: crBenchmark, count: sessions.length,     unit: 'sessions'  },
    { label: 'VAVE Intelligence',   credits: crVave,      count: vaveProjects.length, unit: 'projects'  },
    { label: 'Cost Intelligence',   credits: crProjects,  count: projects.length,     unit: 'projects'  },
    { label: 'BOM Processing',      credits: crBom,       count: totalBoms,           unit: 'BOMs'      },
  ];

  return (
    <div className="relative w-full" style={{ zIndex: 30 }}>
      {/* ── Collapsed bar — full row is the click target ───────────────────────── */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 h-9 gap-6 border-b cursor-pointer bg-card border-border hover:bg-muted/30 transition-colors"
      >
        {/* Brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-primary">
            Mithran AI
          </span>
          <span className="text-[10px] text-muted-foreground/40">·</span>
          <span className="text-[10px] text-muted-foreground">{orgName}</span>
        </div>

        {/* Credit progress bar */}
        <div className="hidden md:flex items-center gap-2.5 flex-1 max-w-xs">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                background: pct > 85 ? 'hsl(0 72% 51%)' : pct > 65 ? 'hsl(38 92% 50%)' : 'linear-gradient(90deg, hsl(187 100% 42%), hsl(220 90% 65%))',
              }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground whitespace-nowrap">
            {usedCredits.toLocaleString('en-IN')} / {PLAN_CREDITS.toLocaleString('en-IN')} credits
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          {totalSavingsL > 0 && (
            <span className="hidden sm:block text-[10px] font-semibold tabular-nums text-green-500">
              ₹{totalSavingsL.toFixed(1)}L identified
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50 select-none">
            {expanded ? '▴' : '▾'}
          </span>
        </div>
      </button>

      {/* ── Expanded dropdown ── */}
      {expanded && (
        <div
          className="absolute left-0 right-0 top-full border-b border-border bg-card shadow-2xl"
          style={{ zIndex: 30 }}
        >
          <div className="px-6 py-5">

            {/* Module-wise credit breakdown */}
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50 mb-3">
              Credit Usage by Module
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border border-border rounded-lg overflow-hidden">
              {breakdown.map(({ label, credits, count, unit }, i) => (
                <div
                  key={label}
                  className={`px-4 py-3 space-y-1 bg-muted/40 ${i < breakdown.length - 1 ? 'border-r border-border' : ''}`}
                >
                  <p className="text-[9px] uppercase tracking-wider text-muted-foreground/50">{label}</p>
                  <p className="text-xl font-bold tabular-nums leading-none text-primary">
                    {credits.toLocaleString('en-IN')}
                    <span className="text-[10px] font-normal text-muted-foreground ml-1">credits</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">{count} {unit}</p>

                  {/* Mini bar showing this module's share */}
                  {usedCredits > 0 && (
                    <div className="h-1 rounded-full mt-1 overflow-hidden bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((credits / usedCredits) * 100)}%`,
                          background: 'hsl(187 100% 42% / 0.6)',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Summary strip */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-0.5">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50">Total Used</p>
                <p className="text-base font-bold tabular-nums">
                  {usedCredits.toLocaleString('en-IN')}
                  <span className="text-[10px] font-normal text-muted-foreground ml-1">credits · {pct}%</span>
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50">Remaining</p>
                <p className="text-base font-bold tabular-nums" style={{ color: pct > 85 ? 'hsl(0 72% 51%)' : pct > 65 ? 'hsl(38 92% 50%)' : 'hsl(140 60% 50%)' }}>
                  {remaining.toLocaleString('en-IN')}
                  <span className="text-[10px] font-normal text-muted-foreground ml-1">credits</span>
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50">Cost Savings</p>
                <p className="text-base font-bold tabular-nums" style={{ color: 'hsl(140 60% 50%)' }}>
                  {totalSavingsL > 0 ? `₹${totalSavingsL.toFixed(1)}L` : '—'}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground/50">Organisation</p>
                <p className="text-base font-bold">{orgName}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
