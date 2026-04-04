export const SPEECH_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "Inglês (EUA)" },
];

const ALLOWED = new Set(SPEECH_LANGUAGE_OPTIONS.map((o) => o.value));

export function sanitizeSpeechLanguageTag(
  raw: unknown,
  fallback: string
): string {
  if (typeof raw !== "string") return fallback;
  return ALLOWED.has(raw) ? raw : fallback;
}

export function getSpeechLanguageLabel(tag: string): string {
  const o = SPEECH_LANGUAGE_OPTIONS.find((x) => x.value === tag);
  return o?.label ?? tag;
}
