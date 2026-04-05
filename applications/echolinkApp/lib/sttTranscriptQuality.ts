const LETTER_U = /\p{L}/u;

const DEFAULT_SHORT_PHRASE_KEYS = new Set([
  "alo",
  "oi",
  "sim",
  "nao",
  "bom",
  "ok",
]);

function alphaKeyFromToken(token: string): string {
  const base = token
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  let s = "";
  for (const ch of base) {
    if (LETTER_U.test(ch)) {
      s += ch;
    }
  }
  return s;
}

function letterCount(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (LETTER_U.test(ch)) {
      n += 1;
    }
  }
  return n;
}

function wordTokens(s: string): string[] {
  return s.split(/\s+/).filter((w) => LETTER_U.test(w));
}

export function sttFinalTextPassesQualityGate(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  const letters = letterCount(t);
  const words = wordTokens(t);
  const minSingle = 5;
  const minMulti = 4;
  const minWordsForMulti = 2;
  if (words.length >= minWordsForMulti) {
    return letters >= minMulti;
  }
  if (words.length === 1) {
    const w = words[0];
    if (w && DEFAULT_SHORT_PHRASE_KEYS.has(alphaKeyFromToken(w))) {
      return true;
    }
  }
  return letters >= minSingle;
}
