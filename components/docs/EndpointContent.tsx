'use client';

import { useState } from 'react';
import { Lock, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MethodBadge } from './MethodBadge';
import { ParamTable } from './ParamTable';
import type { Endpoint } from '@/lib/docs/api-spec-types';

interface EndpointContentProps {
  endpoint: Endpoint;
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
};

function getStatusColor(status: number) {
  if (status >= 200 && status < 300) return 'text-green-400 border-green-500/30 bg-green-500/10';
  if (status >= 400 && status < 500) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
  return 'text-red-400 border-red-500/30 bg-red-500/10';
}

function StatusDot({ status }: { status: number }) {
  if (status >= 200 && status < 300) return <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />;
  if (status >= 400 && status < 500) return <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />;
}

export function EndpointContent({ endpoint }: EndpointContentProps) {
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
  const headerParams = endpoint.parameters.filter((p) => p.in === 'header');

  const successResponses = endpoint.responses.filter((r) => r.statusCode >= 200 && r.statusCode < 300);
  const defaultTab = endpoint.responses.length > 0 ? String(endpoint.responses[0].statusCode) : undefined;

  return (
    <article className="flex-1 overflow-y-auto px-8 py-8 min-w-0">
      {/* Endpoint header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <MethodBadge method={endpoint.method} size="md" />
          <code className="text-sm font-mono text-foreground bg-muted/40 px-3 py-1.5 rounded-lg border border-border/60">
            {endpoint.path}
          </code>
          {endpoint.deprecated && (
            <Badge variant="outline" className="text-amber-400 border-amber-500/50 bg-amber-500/10 text-[10px]">
              Deprecated
            </Badge>
          )}
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">{endpoint.summary}</h1>
        <p className="text-muted-foreground leading-relaxed">{endpoint.description}</p>

        {/* Auth + success response badges */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {endpoint.requiresAuth ? (
            <div className="flex items-center gap-1.5 text-xs text-amber-400">
              <Lock className="h-3.5 w-3.5" />
              Requires authentication
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Public endpoint
            </div>
          )}
          {successResponses.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {successResponses.map((r) => (
                <span
                  key={r.statusCode}
                  className="inline-flex items-center gap-1 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 text-[11px] font-mono text-green-400"
                >
                  {r.statusCode} {HTTP_STATUS_TEXT[r.statusCode] ?? ''}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Parameters */}
      {pathParams.length > 0 && (
        <ParamTable parameters={pathParams} title="Path Parameters" />
      )}
      {queryParams.length > 0 && (
        <ParamTable parameters={queryParams} title="Query Parameters" />
      )}
      {headerParams.length > 0 && (
        <ParamTable parameters={headerParams} title="Header Parameters" />
      )}

      {/* Request body */}
      {endpoint.requestBody && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Request Body
            {endpoint.contentType === 'multipart/form-data' && (
              <Badge variant="outline" className="text-[10px] text-cyan-400 border-cyan-500/30 bg-cyan-500/10 ml-1">
                multipart/form-data
              </Badge>
            )}
          </h4>
          <p className="text-xs text-muted-foreground mb-3">{endpoint.requestBody.description}</p>
          {endpoint.requestBody.schema.properties && (
            <ParamTable
              parameters={endpoint.requestBody.schema.properties.map((p) => ({
                name: p.name,
                in: 'body' as const,
                type: p.type,
                required: p.required ?? false,
                description: p.description ?? '',
                ...(p.example !== undefined ? { example: p.example } : {}),
                ...(p.enum ? { enum: p.enum } : {}),
                ...(p.format ? { format: p.format } : {}),
                ...(p.default !== undefined ? { default: p.default } : {}),
                schema: p,
              }))}
              title="Body Parameters"
            />
          )}
          {endpoint.requestBody.example && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">Example body:</p>
              <pre className="text-xs bg-muted/30 border border-border/60 rounded-lg p-4 overflow-x-auto text-foreground/80 leading-relaxed">
                {JSON.stringify(endpoint.requestBody.example, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Responses — tabbed */}
      {endpoint.responses.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Responses
          </h4>
          {endpoint.responses.length === 1 ? (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30">
                <Badge
                  variant="outline"
                  className={`text-[11px] font-mono ${getStatusColor(endpoint.responses[0].statusCode)}`}
                >
                  {endpoint.responses[0].statusCode}
                </Badge>
                <span className="text-sm text-muted-foreground">{endpoint.responses[0].description}</span>
              </div>
              {endpoint.responses[0].example && (
                <pre className="text-xs p-4 overflow-x-auto text-foreground/80 leading-relaxed bg-muted/10">
                  {JSON.stringify(endpoint.responses[0].example, null, 2)}
                </pre>
              )}
            </div>
          ) : (
            <Tabs defaultValue={defaultTab}>
              <TabsList className="h-auto flex-wrap gap-1 bg-muted/30 p-1 mb-0 rounded-t-lg rounded-b-none border border-b-0 border-border/60">
                {endpoint.responses.map((res) => (
                  <TabsTrigger
                    key={res.statusCode}
                    value={String(res.statusCode)}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 data-[state=active]:bg-background"
                  >
                    <StatusDot status={res.statusCode} />
                    <span className="font-mono">{res.statusCode}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="rounded-b-lg border border-border/60 overflow-hidden">
                {endpoint.responses.map((res) => (
                  <TabsContent key={res.statusCode} value={String(res.statusCode)} className="m-0">
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/40">
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-mono ${getStatusColor(res.statusCode)}`}
                      >
                        {res.statusCode}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{res.description}</span>
                    </div>
                    {res.example ? (
                      <pre className="text-xs p-4 overflow-x-auto text-foreground/80 leading-relaxed bg-muted/10">
                        {JSON.stringify(res.example, null, 2)}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground p-4">No response body.</p>
                    )}
                  </TabsContent>
                ))}
              </div>
            </Tabs>
          )}
        </div>
      )}

      {/* Errors */}
      {endpoint.errors.length > 0 && (
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            Error Codes
          </h4>
          <div className="rounded-lg border border-border/60 overflow-hidden divide-y divide-border/40">
            {endpoint.errors.map((err) => (
              <div key={`${err.statusCode}-${err.code}`} className="flex items-center gap-4 px-4 py-3 bg-muted/10">
                <Badge
                  variant="outline"
                  className={`text-[11px] font-mono shrink-0 ${getStatusColor(err.statusCode)}`}
                >
                  {err.statusCode}
                </Badge>
                {err.code && (
                  <code className="text-xs text-muted-foreground font-mono shrink-0">{err.code}</code>
                )}
                <span className="text-xs text-muted-foreground">{err.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
