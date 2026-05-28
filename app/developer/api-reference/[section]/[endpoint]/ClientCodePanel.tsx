'use client';

import { useState } from 'react';
import { CodePanel } from '@/components/docs/CodePanel';
import { TryItPanel } from '@/components/docs/TryItPanel';
import type { Endpoint, CodeLanguage } from '@/lib/docs/api-spec-types';

interface HighlightedExample {
  language: CodeLanguage;
  label: string;
  html: string;
  raw: string;
}

interface ClientCodePanelProps {
  examples: HighlightedExample[];
  endpoint: Endpoint;
  baseUrl: string;
}

export function ClientCodePanel({ examples, endpoint, baseUrl }: ClientCodePanelProps) {
  const [tryItOpen, setTryItOpen] = useState(false);

  return (
    <>
      <CodePanel examples={examples} onTryIt={() => setTryItOpen(true)} />
      <TryItPanel
        endpoint={endpoint}
        isOpen={tryItOpen}
        onClose={() => setTryItOpen(false)}
        baseUrl={baseUrl}
      />
    </>
  );
}
