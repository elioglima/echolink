export type ElevenLabsVoiceDisplayBundle = {
  voiceLabels: Record<string, string>;
  fallbackVoiceOptions: { value: string; label: string }[];
};

export const EMPTY_ELEVEN_LABS_VOICE_DISPLAY: ElevenLabsVoiceDisplayBundle = {
  voiceLabels: {},
  fallbackVoiceOptions: [],
};

export function labelForElevenLabsVoiceId(
  voiceId: string,
  voiceLabels: Record<string, string>
): string | undefined {
  const t = voiceId.trim();
  if (!t) {
    return undefined;
  }
  const direct = voiceLabels[t];
  if (direct) {
    return direct;
  }
  const lower = t.toLowerCase();
  for (const [k, v] of Object.entries(voiceLabels)) {
    if (k.toLowerCase() === lower) {
      return v;
    }
  }
  return undefined;
}

export function formatElevenLabsVoiceDisplay(
  voiceId: string | undefined | null,
  voiceLabels: Record<string, string>
): string {
  const t = (voiceId ?? "").trim();
  if (!t) {
    return "";
  }
  const label = labelForElevenLabsVoiceId(t, voiceLabels);
  return label ? `${t} = ${label}` : t;
}
