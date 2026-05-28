'use client';

import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { CodeLanguage } from '@/lib/docs/api-spec-types';

interface HighlightedExample {
  language: CodeLanguage;
  label: string;
  html: string;
  raw: string;
}

interface CodePanelProps {
  examples: HighlightedExample[];
  onTryIt: () => void;
}

export function CodePanel({ examples, onTryIt }: CodePanelProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(examples[0]?.language ?? 'curl');

  const handleCopy = () => {
    const active = examples.find((e) => e.language === activeTab);
    if (!active) return;
    navigator.clipboard.writeText(active.raw);
    setCopied(true);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (examples.length === 0) return null;

  return (
    <div className="w-full md:w-[380px] lg:w-[440px] xl:w-[520px] 2xl:w-[600px] shrink-0 h-[calc(100vh-57px)] sticky top-[57px] flex flex-col bg-[#0d1117] border-l border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-xs font-medium text-white/60 uppercase tracking-widest">Request</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Language tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CodeLanguage)} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="bg-transparent border-b border-white/10 rounded-none px-4 h-9 justify-start gap-0 shrink-0">
          {examples.map((ex) => (
            <TabsTrigger
              key={ex.language}
              value={ex.language}
              className="text-xs text-white/40 data-[state=active]:text-white data-[state=active]:bg-white/10 rounded-sm px-3 h-7"
            >
              {ex.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-y-auto">
          {examples.map((ex) => (
            <TabsContent key={ex.language} value={ex.language} className="m-0 p-4 h-full">
              <div
                className="text-xs [&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0 [&>pre]:overflow-x-auto [&_code]:!text-xs [&_code]:!leading-relaxed"
                dangerouslySetInnerHTML={{ __html: ex.html }}
              />
            </TabsContent>
          ))}
        </div>
      </Tabs>

      {/* Try It button */}
      <div className="p-4 border-t border-white/10 shrink-0">
        <Button
          onClick={onTryIt}
          className="w-full gap-2 bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
          size="sm"
        >
          <Play className="h-3.5 w-3.5" />
          Try It
        </Button>
        <p className="text-center text-[10px] text-white/30 mt-2">Requires authentication</p>
      </div>
    </div>
  );
}
