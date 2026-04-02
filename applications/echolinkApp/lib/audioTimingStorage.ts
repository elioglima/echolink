export const TIMING_KEYS = {
  audioChunkMs: "echoLink.audioChunkMs",
  transcriptionStartDelayMs: "echoLink.transcriptionStartDelayMs",
  phraseSilenceCutMs: "echoLink.phraseSilenceCutMs",
} as const;

export type TimingKey = keyof typeof TIMING_KEYS;

export const TIMING_DEFAULTS: Record<TimingKey, number> = {
  audioChunkMs: 250,
  transcriptionStartDelayMs: 0,
  phraseSilenceCutMs: 1200,
};

const RANGES: Record<TimingKey, [number, number]> = {
  audioChunkMs: [50, 4000],
  transcriptionStartDelayMs: [0, 15000],
  phraseSilenceCutMs: [0, 15000],
};

export function clampTiming(key: TimingKey, value: number): number {
  const [min, max] = RANGES[key];
  if (Number.isNaN(value)) return TIMING_DEFAULTS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function loadTimingFromStorage(): Record<TimingKey, number> {
  if (typeof window === "undefined") {
    return { ...TIMING_DEFAULTS };
  }
  const out = { ...TIMING_DEFAULTS };
  (Object.keys(TIMING_KEYS) as TimingKey[]).forEach((key) => {
    const raw = window.localStorage.getItem(TIMING_KEYS[key]);
    if (raw === null) return;
    const n = Number.parseInt(raw, 10);
    out[key] = clampTiming(key, n);
  });
  return out;
}

export function saveTimingToStorage(partial: Partial<Record<TimingKey, number>>): void {
  if (typeof window === "undefined") return;
  (Object.entries(partial) as [TimingKey, number][]).forEach(([key, value]) => {
    const v = clampTiming(key, value);
    window.localStorage.setItem(TIMING_KEYS[key], String(v));
  });
}
