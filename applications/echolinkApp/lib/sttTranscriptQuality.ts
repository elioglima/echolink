const LETTER_U = /\p{L}/u;

const DEFAULT_SHORT_PHRASE_KEYS = new Set([
  "alo",
  "oi",
  "sim",
  "nao",
  "bom",
  "ok",
]);

const FINAL_MAX_TINY_WORD_RATIO = 0.42;
const PARTIAL_MAX_TINY_WORD_RATIO = 0.5;
const PARTIAL_MIN_LETTERS = 6;

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

function tinyWordRatioExceeded(words: string[], maxRatio: number): boolean {
  if (words.length < 3) {
    return false;
  }
  let tiny = 0;
  for (const w of words) {
    const n = alphaKeyFromToken(w).length;
    if (n <= 2) {
      tiny += 1;
    }
  }
  return tiny / words.length > maxRatio;
}

export function sttPartialWorthSending(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  const letters = letterCount(t);
  if (letters < PARTIAL_MIN_LETTERS) {
    return false;
  }
  const words = wordTokens(t);
  if (tinyWordRatioExceeded(words, PARTIAL_MAX_TINY_WORD_RATIO)) {
    return false;
  }
  return true;
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
  if (tinyWordRatioExceeded(words, FINAL_MAX_TINY_WORD_RATIO)) {
    return false;
  }
  if (words.length >= minWordsForMulti) {
    const need = Math.max(minMulti, words.length === 2 ? 6 : 10);
    return letters >= need;
  }
  if (words.length === 1) {
    const w = words[0];
    if (w && DEFAULT_SHORT_PHRASE_KEYS.has(alphaKeyFromToken(w))) {
      return true;
    }
  }
  return letters >= minSingle;
}
