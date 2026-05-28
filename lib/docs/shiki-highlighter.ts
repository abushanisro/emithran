import { createHighlighter, type Highlighter } from 'shiki';

let _highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!_highlighter) {
    _highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: ['bash', 'javascript', 'typescript', 'python', 'go', 'json'],
    });
  }
  return _highlighter;
}

export async function highlight(code: string, lang: string): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, { lang, theme: 'github-dark' });
}
