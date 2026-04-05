import {
  EMPTY_ELEVEN_LABS_VOICE_DISPLAY,
  type ElevenLabsVoiceDisplayBundle,
} from "./elevenLabsVoiceDisplay";
import { isSubstantivePhraseForJournal } from "./substantivePhraseForJournal";
import { fetchEchoLinkService } from "./echoLinkLocalTransport";
import {
  lookupVoiceTranslationCache,
  storeVoiceTranslationCache,
} from "./voiceTranslationCache";

export type VoiceTranslationStatus = {
  translateReady: boolean;
  ttsReady: boolean;
  ready: boolean;
  awsRegion?: string;
  elevenLabsModelId?: string;
  elevenLabsVoiceId?: string;
  elevenLabsVoiceIdLength?: number;
  elevenLabsVoiceIdTail?: string;
  elevenLabsVoiceSettingsActive?: boolean;
  elevenLabsVoiceStability?: number;
  elevenLabsVoiceSimilarity?: number;
  elevenLabsVoiceStyle?: number;
  elevenLabsVoiceSpeakerBoost?: boolean;
};

export async function fetchVoiceTranslationStatus(): Promise<VoiceTranslationStatus> {
  const res = await fetchEchoLinkService("/voiceTranslation/status", {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`voiceTranslation status ${res.status}`);
  }
  return (await res.json()) as VoiceTranslationStatus;
}

export type ElevenLabsVoiceOption = {
  voice_id: string;
  name: string;
  genderSigla?: string;
};

export async function fetchElevenLabsVoiceDisplay(): Promise<ElevenLabsVoiceDisplayBundle> {
  try {
    const res = await fetchEchoLinkService("/voiceTranslation/voiceDisplay", {
      cache: "no-store",
    });
    if (!res.ok) {
      return EMPTY_ELEVEN_LABS_VOICE_DISPLAY;
    }
    const j = (await res.json()) as unknown;
    if (j === null || typeof j !== "object") {
      return EMPTY_ELEVEN_LABS_VOICE_DISPLAY;
    }
    const rec = j as Record<string, unknown>;
    const voiceLabels: Record<string, string> = {};
    const rawLabels = rec.voiceLabels;
    if (rawLabels !== null && typeof rawLabels === "object" && !Array.isArray(rawLabels)) {
      for (const [k, v] of Object.entries(rawLabels)) {
        if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
          voiceLabels[k.trim()] = v.trim();
        }
      }
    }
    const fallbackVoiceOptions: {
      value: string;
      label: string;
      genderSigla?: string;
    }[] = [];
    const rawFb = rec.fallbackVoiceOptions;
    if (Array.isArray(rawFb)) {
      for (const item of rawFb) {
        if (item === null || typeof item !== "object") {
          continue;
        }
        const o = item as Record<string, unknown>;
        const value = typeof o.value === "string" ? o.value.trim() : "";
        const label = typeof o.label === "string" ? o.label.trim() : "";
        if (value && label) {
          const row: {
            value: string;
            label: string;
            genderSigla?: string;
          } = { value, label };
          const gs = o.genderSigla ?? o.gender_sigla;
          if (typeof gs === "string" && (gs === "H" || gs === "F")) {
            row.genderSigla = gs;
          }
          fallbackVoiceOptions.push(row);
        }
      }
    }
    const voiceGenderSiglaById: Record<string, "H" | "F"> = {};
    const rawG = rec.voiceGenderSiglaById ?? rec.voice_gender_sigla_by_id;
    if (rawG !== null && typeof rawG === "object" && !Array.isArray(rawG)) {
      for (const [k, v] of Object.entries(rawG)) {
        const ks = typeof k === "string" ? k.trim().toLowerCase() : "";
        if (v === "H" || v === "F") {
          if (ks) {
            voiceGenderSiglaById[ks] = v;
          }
        }
      }
    }
    return { voiceLabels, fallbackVoiceOptions, voiceGenderSiglaById };
  } catch {
    return EMPTY_ELEVEN_LABS_VOICE_DISPLAY;
  }
}

export async function fetchElevenLabsVoices(): Promise<ElevenLabsVoiceOption[]> {
  const res = await fetchEchoLinkService("/voiceTranslation/voices", {
    cache: "no-store",
  });
  if (!res.ok) {
    return [];
  }
  const j = (await res.json()) as unknown;
  if (!Array.isArray(j)) {
    return [];
  }
  const out: ElevenLabsVoiceOption[] = [];
  for (const item of j) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const rec = item as Record<string, unknown>;
    const voice_id =
      typeof rec.voice_id === "string" ? rec.voice_id.trim() : "";
    if (!voice_id) {
      continue;
    }
    const name =
      typeof rec.name === "string" && rec.name.trim()
        ? rec.name.trim()
        : voice_id;
    const gs = rec.genderSigla ?? rec.gender_sigla;
    if (typeof gs === "string" && (gs === "H" || gs === "F")) {
      out.push({ voice_id, name, genderSigla: gs });
    } else {
      out.push({ voice_id, name });
    }
  }
  return out;
}

export async function fetchTranslatedVoiceAudio(
  ptText: string,
  opts?: { elevenLabsVoiceId?: string }
): Promise<ArrayBuffer> {
  const id = opts?.elevenLabsVoiceId?.trim();
  const res = await fetchEchoLinkService("/voiceTranslation/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: ptText,
      ...(id ? { elevenLabsVoiceId: id } : {}),
    }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") {
        msg = j.detail;
      } else if (j.detail != null) {
        msg = JSON.stringify(j.detail);
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.arrayBuffer();
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

export type TranslatedVoiceWithText = {
  translatedText: string;
  audio: ArrayBuffer;
  origin: "cache" | "network";
};

export type FetchTranslatedVoiceWithTextOptions = {
  elevenLabsVoiceId?: string;
  cacheVoiceId: string;
};

export async function fetchTranslatedVoiceAudioWithText(
  ptText: string,
  opts: FetchTranslatedVoiceWithTextOptions
): Promise<TranslatedVoiceWithText> {
  const cacheVoiceId = opts.cacheVoiceId.trim() || "_default";
  if (typeof window !== "undefined") {
    const cached = await lookupVoiceTranslationCache(ptText, cacheVoiceId);
    if (cached) {
      return { ...cached, origin: "cache" };
    }
  }
  const id = opts.elevenLabsVoiceId?.trim();
  const res = await fetchEchoLinkService("/voiceTranslation/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: ptText,
      includeTranslatedText: true,
      ...(id ? { elevenLabsVoiceId: id } : {}),
    }),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") {
        msg = j.detail;
      } else if (j.detail != null) {
        msg = JSON.stringify(j.detail);
      }
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const j = (await res.json()) as {
    translatedText?: string;
    audioBase64?: string;
  };
  const translatedText =
    typeof j.translatedText === "string" ? j.translatedText : "";
  const b64 = typeof j.audioBase64 === "string" ? j.audioBase64 : "";
  if (!b64) {
    throw new Error("Resposta sem áudio da tradução.");
  }
  const audio = base64ToArrayBuffer(b64);
  const out: TranslatedVoiceWithText = {
    translatedText,
    audio,
    origin: "network",
  };
  if (
    typeof window !== "undefined" &&
    isSubstantivePhraseForJournal(ptText, translatedText)
  ) {
    await storeVoiceTranslationCache(
      ptText,
      translatedText,
      audio,
      cacheVoiceId
    );
  }
  return out;
}

export async function playMp3OnDeviceSink(
  arrayBuffer: ArrayBuffer,
  sinkId: string
): Promise<void> {
  const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(url);
    const media = audio as HTMLAudioElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (sinkId.trim() && typeof media.setSinkId === "function") {
      await media.setSinkId(sinkId);
    }
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () =>
        reject(new Error("Falha ao reproduzir áudio da tradução."));
      void audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
