import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { API_SPEC } from '@/lib/docs/api-spec';
import { getEndpointBySlug, getAllEndpointSlugs } from '@/lib/docs/docs-navigation';
import { highlight } from '@/lib/docs/shiki-highlighter';
import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { EndpointContent } from '@/components/docs/EndpointContent';
import { ClientCodePanel } from './ClientCodePanel';
import type { CodeLanguage } from '@/lib/docs/api-spec-types';

interface PageProps {
  params: Promise<{ section: string; endpoint: string }>;
}

export async function generateStaticParams() {
  return getAllEndpointSlugs(API_SPEC);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { section, endpoint: endpointSlug } = await params;
  const endpoint = getEndpointBySlug(API_SPEC, section, endpointSlug);
  if (!endpoint) return {};
  return {
    title: `${endpoint.summary} — Mithran API`,
    description: endpoint.description,
  };
}

const LANG_MAP: Record<CodeLanguage, string> = {
  curl: 'bash',
  javascript: 'javascript',
  python: 'python',
  go: 'go',
};

export default async function EndpointPage({ params }: PageProps) {
  const { section, endpoint: endpointSlug } = await params;
  const endpoint = getEndpointBySlug(API_SPEC, section, endpointSlug);
  if (!endpoint) notFound();

  // Pre-render all code examples with shiki on the server
  const highlightedExamples = await Promise.all(
    endpoint.examples.map(async (ex) => ({
      language: ex.language,
      label: ex.label,
      raw: ex.code,
      html: await highlight(ex.code, LANG_MAP[ex.language] ?? 'bash'),
    })),
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      <DocsSidebar spec={API_SPEC} activeSection={section} activeEndpoint={endpointSlug} />
      <EndpointContent endpoint={endpoint} />
      <ClientCodePanel
        examples={highlightedExamples}
        endpoint={endpoint}
        baseUrl={API_SPEC.baseUrl}
      />
    </div>
  );
}
