"use client";

import { Bot, Send, RotateCcw, Loader2 } from "lucide-react";
import { useCallback, useRef, useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A memory change the copilot proposed in one turn. Nothing is saved until the user presses Save, which calls the backend's
 * confirm endpoint (single use, within 10 minutes, for this conversation and turn).
 */
interface MemoryProposal {
  proposalId: string;
  add: string[];
  remove: string[];
  expiresAt: string;
  turn: number;
  status: "pending" | "saving" | "saved" | "dismissed" | "failed";
  note?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  proposals?: MemoryProposal[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const AI_ACTIONS: { label: string; prompt: string }[] = [
  {
    label: "Explain",
    prompt:
      "Explain this part's cost breakdown and why each process step costs what it does. Cite sources for every figure.",
  },
  {
    label: "Optimize",
    prompt:
      "What are the top 3 changes to reduce manufacturing cost by at least 15%? Show expected savings for each option.",
  },
  {
    label: "Compare",
    prompt:
      "Compare all feasible manufacturing routes for this part with their pros, cons, cost, and cycle time.",
  },
  {
    label: "Simulate",
    prompt:
      "Compare the total cost per part at three batch sizes (100, 1,000 and 10,000) and rank them. Show what changes between them.",
  },
  {
    label: "Redesign",
    prompt:
      "List the DFM issues on this part and provide specific redesign suggestions to fix each one, with expected impact.",
  },
  {
    label: "Quote",
    prompt:
      "Give an executive summary of this quote: total cost, biggest cost driver, key risk, and recommended action.",
  },
];

// ── Hooks ──────────────────────────────────────────────────────────────────────

const STORAGE_KEY = (id: string) => `copilot_messages_${id}`;
/** What the server accepts in one request (backend dto/chat.dto.ts). */
const MAX_HISTORY_MESSAGES = 8;
const MAX_QUESTION_CHARS = 2000;
const MAX_ANSWER_CHARS = 8000;

/** One JSON object per SSE frame, as written by the NestJS copilot controller. */
type CopilotEvent =
  | { type: "text"; delta: string }
  | { type: "memory_proposal"; proposalId: string; add: string[]; remove: string[]; expiresAt: string }
  | { type: "done" }
  | { type: "error"; code: string };

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "The copilot is busy right now. Try again in a moment.",
  budget_exhausted: "The daily AI allowance is used up. It resets at 00:00 UTC.",
  upstream_unavailable: "The AI service is unavailable. Try again shortly.",
  refused: "The copilot could not answer that question.",
  tool_limit: "That question needed too many steps. Try a narrower question.",
};

const HTTP_ERROR_TEXT: Record<number, string> = {
  400: "That request was not valid. Try a shorter question.",
  401: "Please sign in again.",
  404: "This part was not found.",
  413: "That request was too large.",
  429: "Too many requests. Wait a moment and try again.",
  503: "The copilot is not available right now.",
};

/** The backend's AI budget codes (passed on by the copilot route) and what they mean to the user. */
const AI_CODE_TEXT: Record<string, string> = {
  AI_BUDGET_EXHAUSTED: "The daily AI allowance is used up. It resets at 00:00 UTC.",
  AI_TOO_MANY_REQUESTS: "You already have the maximum number of AI requests running. Wait for one to finish.",
  AI_DISABLED: "AI features are switched off by the operator.",
  AI_NOT_CONFIGURED: "The copilot is not configured.",
};

const CONVERSATION_KEY = (id: string) => `copilot_conversation_${id}`;

/** The id this panel's conversation is known by on the server (a memory proposal is bound to it); new after a reset. */
function conversationIdFor(bomItemId: string): string {
  try {
    const saved = localStorage.getItem(CONVERSATION_KEY(bomItemId));
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(CONVERSATION_KEY(bomItemId), id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

interface CopilotScenario {
  batchSize: number;
  productionLife: number;
  location: string;
}

function useCopilotChat(bomItemId: string, scenario: CopilotScenario) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY(bomItemId));
      return saved ? (JSON.parse(saved) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState(() => conversationIdFor(bomItemId));
  const abortRef = useRef<AbortController | null>(null);

  // Persist completed messages to localStorage (never save in-flight streaming ones)
  useEffect(() => {
    const completed = messages.filter((m) => !m.streaming);
    try {
      localStorage.setItem(STORAGE_KEY(bomItemId), JSON.stringify(completed));
    } catch {
      // localStorage full or unavailable — silently skip
    }
  }, [messages, bomItemId]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    try {
      localStorage.removeItem(STORAGE_KEY(bomItemId));
      localStorage.removeItem(CONVERSATION_KEY(bomItemId));
    } catch { /* ignore */ }
    setConversationId(conversationIdFor(bomItemId));
  }, [bomItemId]);

  const updateProposal = useCallback((proposalId: string, patch: Partial<MemoryProposal>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.proposals?.some((p) => p.proposalId === proposalId)
          ? { ...m, proposals: m.proposals.map((p) => (p.proposalId === proposalId ? { ...p, ...patch } : p)) }
          : m,
      ),
    );
  }, []);

  /** Save: the only way a copilot proposal reaches saved memory. */
  const confirmProposal = useCallback(
    async (proposal: MemoryProposal) => {
      updateProposal(proposal.proposalId, { status: "saving" });
      try {
        await apiClient.post(
          `/copilot/memory-proposals/${proposal.proposalId}/confirm`,
          { conversationId, turn: proposal.turn },
          { retry: false },
        );
        updateProposal(proposal.proposalId, { status: "saved" });
      } catch (e) {
        updateProposal(proposal.proposalId, { status: "failed", note: e instanceof Error ? e.message : "Could not save." });
      }
    },
    [conversationId, updateProposal],
  );

  const dismissProposal = useCallback(
    (proposal: MemoryProposal) => { updateProposal(proposal.proposalId, { status: "dismissed" }); },
    [updateProposal],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim().slice(0, MAX_QUESTION_CHARS);
      if (!trimmed || isStreaming) return;

      setError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
      };
      const assistantId = `a-${Date.now()}`;
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
      setIsStreaming(true);

      const dropPlaceholder = () => {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
      };

      // The server rebuilds everything else (part facts, costs, features) from the part id with this user's own access.
      const history = [...messages, userMsg]
        .filter((m) => m.content.trim())
        .slice(-MAX_HISTORY_MESSAGES)
        .map((m) => ({
          role: m.role,
          // Answers saved from earlier sessions can exceed what the server accepts; trimming old history is harmless.
          content: m.content.slice(0, m.role === "user" ? MAX_QUESTION_CHARS : MAX_ANSWER_CHARS),
        }));
      // Which user message of the conversation this is (all of it, not only the history sent).
      const turn = [...messages, userMsg].filter((m) => m.role === "user").length;
      const payload = {
        bomItemId,
        conversationId,
        turn,
        location: scenario.location,
        batchSize: scenario.batchSize,
        productionLifeYears: scenario.productionLife,
        messages: history,
      };

      let resp: Response;
      try {
        resp = await fetch("/api/manufacturing-copilot/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Network error. Please try again.");
        dropPlaceholder();
        setIsStreaming(false);
        return;
      }

      if (!resp.ok || !resp.body) {
        const code = ((await resp.json().catch(() => null)) as { code?: string } | null)?.code;
        setError((code && AI_CODE_TEXT[code]) ?? HTTP_ERROR_TEXT[resp.status] ?? "The copilot is unavailable. Try again shortly.");
        dropPlaceholder();
        setIsStreaming(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const handle = (event: CopilotEvent) => {
        if (event.type === "text") {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + event.delta, streaming: true } : m)),
          );
        } else if (event.type === "memory_proposal") {
          const { proposalId, add, remove, expiresAt } = event;
          const proposal: MemoryProposal = { proposalId, add, remove, expiresAt, turn, status: "pending" };
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, proposals: [...(m.proposals ?? []), proposal] } : m)),
          );
        } else if (event.type === "error") {
          setError(ERROR_TEXT[event.code] ?? "Something went wrong. Try again.");
        }
      };

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
            if (dataLine) handle(JSON.parse(dataLine.slice(6)) as CopilotEvent);
          }
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError("Stream interrupted.");
      }

      // Finalise: remove the streaming flag, and drop an answer that never received text.
      setMessages((prev) =>
        prev
          .map((m) => (m.id === assistantId ? { ...m, streaming: false } : m))
          .filter((m) => m.id !== assistantId || m.content || m.proposals?.length),
      );
      setIsStreaming(false);
    },
    [bomItemId, conversationId, isStreaming, messages, scenario.batchSize, scenario.productionLife, scenario.location],
  );

  return { messages, isStreaming, error, send, reset, confirmProposal, dismissProposal };
}

// ── Copilot response renderer ──────────────────────────────────────────────────

function parseInline(text: string, showSources: boolean): React.ReactNode {
  if (!showSources) {
    const cleanText = text.replace(/\s*(?:—|-|:)?\s*(?:\(source:[^)]+\)|Source:[^\n]+)/gi, "");
    const parts = cleanText.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  }

  const parts = text.split(/(\*\*[^*]+\*\*|\(source:[^)]+\)|Source:[^\n]+)/gi);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    const partLower = part.toLowerCase();
    if (partLower.startsWith("(source:") || partLower.startsWith("source:")) {
      return <span key={i} className="text-[9px] text-muted-foreground/50 ml-1">{part}</span>;
    }
    return part;
  });
}

function CopilotResponse({ content, showSources }: { content: string; showSources: boolean }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      nodes.push(<div key={i++} className="h-1.5" />);
      continue;
    }

    // Section header: line that is purely **text** (possibly with — suffix)
    if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
      const inner = trimmed.slice(2, -2);
      const isTitle = nodes.length === 0 || (nodes.length <= 2);
      nodes.push(
        <div key={i++} className={cn(
          "font-semibold",
          isTitle
            ? "text-[11px] text-foreground mb-1"
            : "text-[9px] uppercase tracking-wider text-brand-600 dark:text-brand-400 mt-3 mb-1 border-b border-brand-100 dark:border-brand-900 pb-0.5",
        )}>
          {inner}
        </div>
      );
      continue;
    }

    // Numbered items ①②③④⑤⑥⑦⑧⑨
    if (/^[①②③④⑤⑥⑦⑧⑨]/.test(trimmed)) {
      const rest = trimmed.slice(1).trim();
      nodes.push(
        <div key={i++} className="flex gap-2 py-1.5 border-b border-border/30 last:border-0">
          <span className="shrink-0 w-4 h-4 rounded-full bg-brand-100 dark:bg-brand-950/60 text-brand-700 dark:text-brand-300 text-[8px] font-bold flex items-center justify-center mt-0.5">
            {trimmed[0]}
          </span>
          <span className="text-[10px] leading-relaxed">{parseInline(rest, showSources)}</span>
        </div>
      );
      continue;
    }

    // Source citation lines (indented)
    if (/^\s*(Source:|source:)/i.test(rawLine)) {
      if (!showSources) continue;
      nodes.push(
        <div key={i++} className="text-[9px] text-muted-foreground/50 pl-6 -mt-1 mb-0.5">
          {trimmed}
        </div>
      );
      continue;
    }

    // Opportunity lines ✓
    if (trimmed.startsWith("✓")) {
      nodes.push(
        <div key={i++} className="flex items-start gap-1.5 py-0.5">
          <span className="text-emerald-500 shrink-0 text-[11px] mt-0.5">✓</span>
          <span className="text-[10px] leading-relaxed">{parseInline(trimmed.slice(1).trim(), showSources)}</span>
        </div>
      );
      continue;
    }

    // Key-value lines like "Machine: X" / "Total cost: $X"
    const kvMatch = /^(Machine|Total cost|Cycle time|Material|NRE|Break-even):\s*(.+)$/.exec(trimmed);
    if (kvMatch) {
      nodes.push(
        <div key={i++} className="flex gap-1.5 py-0.5 text-[10px]">
          <span className="text-muted-foreground shrink-0">{kvMatch[1]}:</span>
          <span className="font-medium text-foreground">{parseInline(kvMatch[2] ?? "", showSources)}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={i++} className="text-[10px] leading-relaxed text-foreground/80">
        {parseInline(trimmed, showSources)}
      </p>
    );
  }

  return <div>{nodes}</div>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** "Save to memory" confirmation for one copilot proposal. Text is rendered as text, never as markup. */
export function MemoryProposalChip({
  proposal,
  onSave,
  onDismiss,
}: {
  proposal: MemoryProposal;
  onSave: (p: MemoryProposal) => void;
  onDismiss: (p: MemoryProposal) => void;
}) {
  const expired = proposal.status === "pending" && Date.parse(proposal.expiresAt) <= Date.now();
  return (
    <div className="mt-1.5 rounded border border-brand-200 dark:border-brand-800 bg-background px-2 py-1.5 text-[10px]" data-testid="memory-proposal">
      <p className="font-medium text-foreground">Save to copilot memory?</p>
      {proposal.add.map((p) => (
        <p key={`a-${p}`} className="text-foreground/80">+ {p}</p>
      ))}
      {proposal.remove.map((p) => (
        <p key={`r-${p}`} className="text-foreground/80 line-through">{p}</p>
      ))}
      {proposal.status === "pending" && !expired && (
        <div className="mt-1 flex gap-1.5">
          <Button size="sm" className="h-5 px-2 text-[10px]" onClick={() => { onSave(proposal); }}>Save</Button>
          <Button size="sm" variant="outline" className="h-5 px-2 text-[10px]" onClick={() => { onDismiss(proposal); }}>Dismiss</Button>
        </div>
      )}
      {proposal.status === "saving" && <p className="mt-1 text-muted-foreground">Saving…</p>}
      {proposal.status === "saved" && <p className="mt-1 text-emerald-600">Saved. Manage it in Settings, Preferences.</p>}
      {proposal.status === "dismissed" && <p className="mt-1 text-muted-foreground">Dismissed: nothing was saved.</p>}
      {proposal.status === "failed" && <p className="mt-1 text-destructive">{proposal.note ?? "Could not save."}</p>}
      {expired && <p className="mt-1 text-muted-foreground">Expired: nothing was saved. Ask the copilot again.</p>}
    </div>
  );
}

function MessageBubble({
  msg,
  showSources,
  onSave,
  onDismiss,
}: {
  msg: ChatMessage;
  showSources: boolean;
  onSave: (p: MemoryProposal) => void;
  onDismiss: (p: MemoryProposal) => void;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2 px-3 py-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5",
          isUser ? "bg-brand-100 text-brand-600" : "bg-slate-100 text-slate-500",
        )}
      >
        {isUser ? (
          <span className="text-[8px] font-bold">U</span>
        ) : (
          <Bot className="w-3 h-3" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-2.5 py-1.5",
          isUser
            ? "bg-brand-50 text-brand-900 dark:bg-brand-950/40 dark:text-brand-100 text-[11px] leading-relaxed"
            : "bg-muted text-foreground",
        )}
      >
        {isUser
          ? <span className="text-[11px] leading-relaxed whitespace-pre-wrap">{msg.content}</span>
          : msg.content
            ? <CopilotResponse content={msg.content} showSources={showSources} />
            : null
        }
        {!msg.content && msg.streaming && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="text-[10px]">Thinking…</span>
          </span>
        )}
        {msg.streaming && msg.content && (
          <span className="inline-block w-1 h-3 bg-brand-500 animate-pulse ml-0.5 align-text-bottom" />
        )}
        {msg.proposals?.map((p) => (
          <MemoryProposalChip key={p.proposalId} proposal={p} onSave={onSave} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface CopilotPanelProps {
  itemId: string;
  batchSize: number;
  productionLife: number;
  factory: string;
}

export function CopilotPanel({ itemId, batchSize, productionLife, factory }: CopilotPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, isStreaming, error, send, reset, confirmProposal, dismissProposal } = useCopilotChat(itemId, {
    batchSize,
    productionLife,
    location: factory,
  });

  // Auto-scroll to bottom on new tokens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput("");
    await send(text);
  }, [input, isStreaming, send]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleAction = useCallback(
    async (prompt: string) => {
      if (isStreaming) return;
      setInput("");
      await send(prompt);
    },
    [isStreaming, send],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0 bg-muted/30">
        <span className="text-[10px] font-medium text-foreground shrink-0">Manufacturing Copilot</span>
        <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-brand-100 text-brand-600 dark:bg-brand-950/40 dark:text-brand-400 border border-brand-200 dark:border-brand-800">BETA</span>
        <div className="flex-1" />
        {messages.length > 0 && (
          <button
            onClick={reset}
            className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            title="Clear conversation"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ── AI Actions bar ─────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 px-3 py-2 border-b shrink-0 overflow-x-auto">
        {AI_ACTIONS.map((action) => (
          <button
            key={action.label}
            onClick={() => void handleAction(action.prompt)}
            disabled={isStreaming}
            className={cn(
              "shrink-0 text-[10px] font-medium px-2 py-0.5 rounded border transition-colors",
              isStreaming
                ? "opacity-40 cursor-not-allowed border-border text-muted-foreground"
                : "border-brand-200 text-brand-700 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/40",
            )}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* ── Messages ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
            <div>
              <p className="text-[11px] font-medium text-foreground">Manufacturing Copilot</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                Grounded in your cost engine, DFM, and CAD geometry. Ask anything or use an action above.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 justify-center max-w-[220px]">
              {[
                "Why is this part expensive?",
                "Can I use die casting?",
                "Explain clamp force warning",
                "How to reduce cost 20%?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => void handleAction(q)}
                  className="text-[10px] border border-border rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground hover:border-brand-400 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const showSources = messages.some(
            (m) =>
              m.role === "user" &&
              /\b(source|citation|cite|reference|where did|where from|provenance|grounding)\b/i.test(m.content)
          );
          return (
            <MessageBubble key={msg.id} msg={msg} showSources={showSources} onSave={(p) => void confirmProposal(p)} onDismiss={dismissProposal} />
          );
        })}

        {error && (
          <div className="mx-3 mb-2 p-2 rounded bg-destructive/10 text-destructive text-[10px]">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t p-2 flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => { setInput(e.target.value); }}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
          maxLength={MAX_QUESTION_CHARS}
          placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"
          rows={2}
          className={cn(
            "flex-1 resize-none rounded border bg-background text-[11px] px-2.5 py-1.5 placeholder:text-muted-foreground/50",
            "focus:outline-hidden focus:ring-1 focus:ring-brand-500",
            isStreaming && "opacity-50",
          )}
        />
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={isStreaming || !input.trim()}
          className="h-8 w-8 p-0 shrink-0 bg-brand-600 hover:bg-brand-700"
        >
          {isStreaming ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>

      {/* ── Footer attribution ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 pb-1.5 text-[9px] text-muted-foreground/40 text-center">
        Powered by AI · Figures from Mithran engines · Not a substitute for engineering judgment
      </div>
    </div>
  );
}
