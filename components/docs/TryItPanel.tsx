'use client';

import { useState, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Lock, Play, Loader2, AlertCircle, Terminal } from 'lucide-react';
import { useAuth } from '@/lib/providers/auth';
import { MethodBadge } from './MethodBadge';
import type { Endpoint } from '@/lib/docs/api-spec-types';
import Link from 'next/link';

interface TryItPanelProps {
  endpoint: Endpoint;
  isOpen: boolean;
  onClose: () => void;
  baseUrl: string;
}

interface ResponseState {
  status: number;
  statusText: string;
  body: string;
  time: number;
}

function getStatusColor(status: number) {
  if (status >= 200 && status < 300) return 'bg-green-500/15 text-green-400 border-green-500/30';
  if (status >= 400 && status < 500) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-red-500/15 text-red-400 border-red-500/30';
}

function buildInitialValues(endpoint: Endpoint): Record<string, string> {
  const init: Record<string, string> = {};
  endpoint.parameters.forEach((p) => {
    if (p.example !== undefined) init[p.name] = String(p.example);
    else if (p.default !== undefined) init[p.name] = String(p.default);
  });
  endpoint.requestBody?.schema.properties?.forEach((prop) => {
    if (prop.example !== undefined) init[prop.name] = String(prop.example);
  });
  return init;
}

export function TryItPanel({ endpoint, isOpen, onClose, baseUrl }: TryItPanelProps) {
  const { user } = useAuth();
  const [token, setToken] = useState('');
  const [paramValues, setParamValues] = useState<Record<string, string>>(
    () => buildInitialValues(endpoint),
  );
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [showCurl, setShowCurl] = useState(false);

  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');

  const buildUrl = () => {
    let url = `${baseUrl}${endpoint.path}`;
    pathParams.forEach((p) => {
      url = url.replace(`{${p.name}}`, paramValues[p.name] || `{${p.name}}`);
    });
    const query = queryParams
      .filter((p) => paramValues[p.name])
      .map((p) => `${p.name}=${encodeURIComponent(paramValues[p.name] ?? '')}`)
      .join('&');
    if (query) url += `?${query}`;
    return url;
  };

  const buildBody = () => {
    if (!endpoint.requestBody) return undefined;
    const body: Record<string, unknown> = {};
    endpoint.requestBody.schema.properties?.forEach((prop) => {
      if (paramValues[prop.name] !== undefined && paramValues[prop.name] !== '') {
        body[prop.name] = paramValues[prop.name];
      } else if (endpoint.requestBody?.example?.[prop.name] !== undefined) {
        body[prop.name] = endpoint.requestBody.example[prop.name];
      }
    });
    return JSON.stringify(body, null, 2);
  };

  const curlPreview = useMemo(() => {
    const url = buildUrl();
    const method = endpoint.method;
    const lines: string[] = [`curl -X ${method} '${url}'`];
    if (token) lines.push(`  -H 'Authorization: Bearer ${token}'`);
    if (endpoint.requestBody) {
      lines.push(`  -H 'Content-Type: application/json'`);
      const body = buildBody();
      if (body) lines.push(`  -d '${body.replace(/\n/g, ' ')}'`);
    }
    return lines.join(' \\\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramValues, token]);

  const handleSend = async () => {
    setLoading(true);
    setResponse(null);
    const start = Date.now();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const bodyStr = endpoint.method !== 'GET' ? buildBody() : null;
      const res = await fetch(buildUrl(), {
        method: endpoint.method,
        headers,
        ...(bodyStr != null ? { body: bodyStr } : {}),
      });

      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {}

      setResponse({
        status: res.status,
        statusText: res.statusText,
        body: pretty,
        time: Date.now() - start,
      });
    } catch (err) {
      setResponse({ status: 0, statusText: 'Network Error', body: String(err), time: Date.now() - start });
    } finally {
      setLoading(false);
    }
  };

  const isMultipart = endpoint.contentType === 'multipart/form-data';

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-[520px] overflow-y-auto p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MethodBadge method={endpoint.method} size="md" />
            <code className="text-sm font-mono text-muted-foreground">{endpoint.path}</code>
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">{endpoint.summary}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Auth section */}
          {endpoint.requiresAuth && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-2">
                <Lock className="h-3 w-3" />
                Authentication
              </Label>
              {!user ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-300">
                    <Link href="/auth" className="underline font-medium">Sign in</Link>
                    {' '}to use Try It with your account token.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="Bearer token (paste your JWT)"
                    className="font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">Your session token is not auto-filled for security. Paste it from your dashboard.</p>
                </div>
              )}
            </div>
          )}

          {/* multipart notice */}
          {isMultipart && (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3">
              <p className="text-xs text-cyan-300">This endpoint uses <code className="font-mono">multipart/form-data</code>. Use a tool like Postman or the cURL example to send file uploads.</p>
            </div>
          )}

          {/* Path params */}
          {!isMultipart && pathParams.length > 0 && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Path Parameters</Label>
              <div className="space-y-3">
                {pathParams.map((p) => (
                  <div key={p.name}>
                    <Label htmlFor={`path-${p.name}`} className="text-xs font-medium flex items-center gap-1.5">
                      <code className="text-primary">{p.name}</code>
                      {p.required && <span className="text-amber-400 text-[10px]">required</span>}
                    </Label>
                    <Input
                      id={`path-${p.name}`}
                      value={paramValues[p.name] ?? ''}
                      onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                      placeholder={p.example ? String(p.example) : p.name}
                      className="mt-1 font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">{p.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Query params */}
          {!isMultipart && queryParams.length > 0 && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Query Parameters</Label>
              <div className="space-y-3">
                {queryParams.map((p) => (
                  <div key={p.name}>
                    <Label htmlFor={`query-${p.name}`} className="text-xs font-medium flex items-center gap-1.5">
                      <code className="text-primary">{p.name}</code>
                      {p.required && <span className="text-amber-400 text-[10px]">required</span>}
                    </Label>
                    <Input
                      id={`query-${p.name}`}
                      value={paramValues[p.name] ?? ''}
                      onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                      placeholder={p.example ? String(p.example) : (p.default ? String(p.default) : p.name)}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Request body */}
          {!isMultipart && endpoint.requestBody && (
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Request Body</Label>
              <div className="space-y-3">
                {endpoint.requestBody.schema.properties?.map((prop) => (
                  <div key={prop.name}>
                    <Label htmlFor={`body-${prop.name}`} className="text-xs font-medium flex items-center gap-1.5">
                      <code className="text-primary">{prop.name}</code>
                      <code className="text-muted-foreground text-[10px]">{prop.type}</code>
                      {prop.required && <span className="text-amber-400 text-[10px]">required</span>}
                    </Label>
                    <Input
                      id={`body-${prop.name}`}
                      value={paramValues[prop.name] ?? ''}
                      onChange={(e) => setParamValues((prev) => ({ ...prev, [prop.name]: e.target.value }))}
                      placeholder={prop.example ? String(prop.example) : prop.name}
                      className="mt-1 font-mono text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* cURL preview */}
          {!isMultipart && (
            <div>
              <button
                onClick={() => setShowCurl((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Terminal className="h-3 w-3" />
                {showCurl ? 'Hide' : 'Show'} cURL preview
              </button>
              {showCurl && (
                <pre className="mt-2 text-[11px] bg-[#0d1117] border border-border/60 rounded-lg p-3 overflow-x-auto text-green-400/90 leading-relaxed font-mono">
                  {curlPreview}
                </pre>
              )}
            </div>
          )}

          {/* Response */}
          {response && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Response</Label>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${getStatusColor(response.status)}`}
                  >
                    {response.status} {response.statusText}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">{response.time}ms</span>
                </div>
              </div>
              <pre className="text-xs bg-muted/30 border border-border rounded-lg p-3 overflow-x-auto max-h-64 text-foreground/80 leading-relaxed">
                {response.body}
              </pre>
            </div>
          )}
        </div>

        {/* Send button */}
        <div className="px-6 py-4 border-t border-border shrink-0">
          <Button
            onClick={handleSend}
            disabled={loading || isMultipart || (endpoint.requiresAuth && !token)}
            className="w-full gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                {isMultipart ? 'Use cURL for file uploads' : 'Send Request'}
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
