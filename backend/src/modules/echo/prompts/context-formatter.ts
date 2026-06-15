import type { PageContextDto } from '../dto/page-context.dto';
import type { EntitySnapshot } from '../services/entity-hydrator.service';

/**
 * Formats the per-turn user message: page context + (hydrated) entity snapshot
 * + optional DOM snippet + the user's actual question.
 *
 * Lives in `prompts/` rather than `services/` to make it obvious that any
 * change here directly affects token cost.
 */
export function formatTurn(args: {
  pageContext: PageContextDto;
  snapshot: EntitySnapshot | null;
  domSnippet?: { text: string };
  userMessage: string;
}): string {
  const parts: string[] = [];

  parts.push(`<page route="${escape(args.pageContext.route)}">`);
  if (args.pageContext.breadcrumbs?.length) {
    parts.push(
      `<breadcrumbs>${args.pageContext.breadcrumbs.map(escape).join(' > ')}</breadcrumbs>`,
    );
  }
  parts.push('</page>');

  if (args.snapshot) {
    parts.push(
      `<entity type="${escape(args.snapshot.entityType)}" id="${escape(args.snapshot.entityId)}">`,
    );
    parts.push(JSON.stringify(args.snapshot.data, null, 2));
    parts.push('</entity>');
  }

  if (args.domSnippet?.text?.trim()) {
    parts.push('<user-visible-content>');
    parts.push(args.domSnippet.text.trim().slice(0, 2000));
    parts.push('</user-visible-content>');
  }

  parts.push('<question>');
  parts.push(args.userMessage.trim());
  parts.push('</question>');

  return parts.join('\n');
}

function escape(s: string): string {
  return String(s).replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '&' ? '&amp;' :
    c === '"' ? '&quot;' :
    '&#39;',
  );
}
