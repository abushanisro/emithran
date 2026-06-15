'use client';

import { Sparkles, User } from 'lucide-react';

import type { EchoChatMessage } from '@/lib/echo/types';
import { cn } from '@/lib/utils';

import { EchoToolCallChip } from './EchoToolCallChip';

/**
 * Renders one chat bubble. We deliberately don't pull in a heavy markdown
 * library — Echo's responses are short, and react-markdown would add ~80kb.
 * Lightweight inline formatting (bold, code, list, line breaks) is enough.
 */
export function EchoMessage({ message }: { message: EchoChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'h-7 w-7 shrink-0 rounded-full flex items-center justify-center',
          isUser
            ? 'bg-muted text-muted-foreground'
            : 'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-violet-600 text-white',
        )}
        aria-hidden
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          'rounded-lg px-3 py-2 max-w-[88%] text-sm leading-relaxed',
          isUser
            ? 'bg-muted text-foreground'
            : 'bg-background border border-border text-foreground',
        )}
      >
        {message.toolCalls?.map((c) => (
          <EchoToolCallChip key={c.index} call={c} />
        ))}
        <FormattedText
          text={message.content || (message.streaming ? '…' : '')}
        />
      </div>
    </div>
  );
}

function FormattedText({ text }: { text: string }) {
  // Very small inline parser: `code`, **bold**, line breaks, bullet lists.
  // We avoid html injection by escaping first.
  if (!text) return null;
  const safe = text;
  const lines = safe.split(/\r?\n/);

  return (
    <div className="space-y-1.5">
      {lines.map((ln, i) => {
        if (/^\s*[-*]\s+/.test(ln)) {
          return (
            <div key={i} className="pl-4 relative">
              <span className="absolute left-1 top-2.5 h-1.5 w-1.5 rounded-full bg-current opacity-60" />
              {renderInline(ln.replace(/^\s*[-*]\s+/, ''))}
            </div>
          );
        }
        if (/^\s*\d+\.\s+/.test(ln)) {
          const m = /^\s*(\d+)\.\s+(.*)$/.exec(ln);
          return (
            <div key={i} className="pl-5 relative tabular-nums">
              <span className="absolute left-0 top-0">{m?.[1]}.</span>
              {renderInline(m?.[2] ?? '')}
            </div>
          );
        }
        if (ln.trim() === '') return <div key={i} className="h-1" />;
        return <div key={i}>{renderInline(ln)}</div>;
      })}
    </div>
  );
}

function renderInline(s: string): React.ReactNode {
  // Tokenise on **bold** and `code` while preserving order.
  const out: React.ReactNode[] = [];
  let rest = s;
  let key = 0;
  while (rest.length > 0) {
    const bold = /^(.*?)\*\*([^*]+)\*\*/s.exec(rest);
    const code = /^(.*?)`([^`]+)`/s.exec(rest);
    const first =
      bold && code
        ? (bold[0].length < code[0].length ? 'bold' : 'code')
        : bold
          ? 'bold'
          : code
            ? 'code'
            : null;
    if (!first) {
      out.push(rest);
      break;
    }
    const m = first === 'bold' ? bold : code;
    if (!m) break;
    if (m[1]) out.push(m[1]);
    if (first === 'bold') {
      out.push(
        <strong key={`b-${String(key++)}`} className="font-semibold">
          {m[2]}
        </strong>,
      );
    } else {
      out.push(
        <code
          key={`c-${String(key++)}`}
          className="px-1 py-0.5 rounded bg-muted text-[12px] font-mono"
        >
          {m[2]}
        </code>,
      );
    }
    rest = rest.slice(m[0].length);
  }
  return out;
}
