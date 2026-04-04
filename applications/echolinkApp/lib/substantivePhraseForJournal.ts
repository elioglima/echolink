const LETTER_RE = /\p{L}/gu;

function letterCount(s: string): number {
  const m = s.match(LETTER_RE);
  return m ? m.length : 0;
}

export function isSubstantivePhraseForJournal(pt: string, en: string): boolean {
  const a = pt.trim();
  const b = en.trim();
  if (a.length < 2 || b.length < 2) {
    return false;
  }
  if (letterCount(a) < 2 || letterCount(b) < 2) {
    return false;
  }
  return true;
}
