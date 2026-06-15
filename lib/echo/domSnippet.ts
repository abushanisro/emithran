/**
 * Extract a short, plain-text slice of the page that Echo can attach to a
 * chat turn when the user opts in.
 *
 * Rules — strict on purpose, since this content goes into the LLM prompt:
 *   1. Only read from elements explicitly marked `data-echo-context`. Pages
 *      decide what's shareable; nothing is grabbed by default.
 *   2. Skip form inputs (text boxes, selects, password fields) entirely.
 *   3. Hard-cap at 2 000 characters. Truncate from the end with an ellipsis.
 *   4. Collapse whitespace so token usage stays minimal.
 */

export function extractEchoDomSnippet(maxChars = 2000): string | null {
  if (typeof document === 'undefined') return null;

  const containers = Array.from(
    document.querySelectorAll<HTMLElement>('[data-echo-context]'),
  );
  if (containers.length === 0) return null;

  const parts: string[] = [];
  for (const el of containers) {
    if (parts.join('\n\n').length >= maxChars) break;
    const text = extractText(el);
    if (text) parts.push(text);
  }

  const combined = parts.join('\n\n').replace(/\s+/g, ' ').trim();
  if (!combined) return null;
  return combined.length > maxChars
    ? `${combined.slice(0, maxChars - 1)  }…`
    : combined;
}

function extractText(root: HTMLElement): string {
  const SKIP_TAGS = new Set([
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG',
  ]);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let parent: Node | null = node.parentNode;
      while (parent) {
        if (parent.nodeType === Node.ELEMENT_NODE) {
          const tag = (parent as HTMLElement).tagName;
          if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          // Honor aria-hidden and visually-hidden patterns
          if ((parent as HTMLElement).getAttribute('aria-hidden') === 'true') {
            return NodeFilter.FILTER_REJECT;
          }
        }
        parent = parent.parentNode;
      }
      const value = node.nodeValue?.trim();
      return value ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const buf: string[] = [];
  let next = walker.nextNode();
  while (next) {
    buf.push(next.nodeValue?.trim() ?? '');
    next = walker.nextNode();
  }
  return buf.join(' ').replace(/\s+/g, ' ').trim();
}
