export type ElevenLabsVoiceDisplayBundle = {
  voiceLabels: Record<string, string>;
  fallbackVoiceOptions: {
    value: string;
    label: string;
    genderSigla?: string;
  }[];
  voiceGenderSiglaById?: Record<string, "H" | "F">;
};

export const EMPTY_ELEVEN_LABS_VOICE_DISPLAY: ElevenLabsVoiceDisplayBundle = {
  voiceLabels: {},
  fallbackVoiceOptions: [],
  voiceGenderSiglaById: {},
};

export function resolveElevenLabsGenderSigla(
  voiceId: string,
  bundle: ElevenLabsVoiceDisplayBundle,
  fromApi?: string
): "H" | "F" | undefined {
  if (fromApi === "H" || fromApi === "F") {
    return fromApi;
  }
  const m = bundle.voiceGenderSiglaById;
  if (!m) {
    return undefined;
  }
  const k = voiceId.trim().toLowerCase();
  if (!k) {
    return undefined;
  }
  const g = m[k];
  return g === "H" || g === "F" ? g : undefined;
}

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
