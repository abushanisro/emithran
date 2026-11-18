/** The longest a note's lead may be before it is cut at a word (the rest stays one click away). */
export const NOTE_LEAD_MAX = 140;

/** Abbreviations whose period does not end a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|approx|incl|no|min|max)$/i;

function firstSentence(t: string): string {
  for (const m of t.matchAll(/[.!?](?=\s+["(]?[A-Z])/g)) {
    if (!ABBREVIATION.test(t.slice(0, m.index))) return t.slice(0, m.index + 1);
  }
  return t;
}

/**
 * A long engine note as its core point and the detail behind it. The lead is the first sentence (a period followed by a capital, so
 * "e.g." and "$0.425/part" do not split it), cut at a word when longer than NOTE_LEAD_MAX; `rest` is what the lead leaves out, null when
 * the note is already short. Nothing is dropped: the reader can always open the rest.
 */
export function splitNote(text: string, max = NOTE_LEAD_MAX): { lead: string; rest: string | null } {
  const t = text.trim();
  const sentence = firstSentence(t);
  if (sentence.length <= max) {
    const rest = t.slice(sentence.length).trim();
    return { lead: sentence, rest: rest || null };
  }
  const cut = sentence.lastIndexOf(' ', max);
  const at = cut > max / 2 ? cut : max;
  return { lead: `${sentence.slice(0, at).replace(/[,;:\s]+$/, '')}…`, rest: t.slice(at).trim() };
}
