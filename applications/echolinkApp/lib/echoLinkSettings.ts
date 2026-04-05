import { sanitizeSpeechLanguageTag } from "./speechLanguages";

export const TIMING_KEYS = {
  audioChunkMs: "echoLink.audioChunkMs",
  transcriptionStartDelayMs: "echoLink.transcriptionStartDelayMs",
  phraseSilenceCutMs: "echoLink.phraseSilenceCutMs",
} as const;

export type TimingKey = keyof typeof TIMING_KEYS;

export type EchoLinkSettingsKey =
  | TimingKey
  | "inputSensitivity"
  | "primaryChannelMixGainPercent"
  | "secondaryChannelMixGainPercent"
  | "tertiaryChannelMixGainPercent"
  | "outputChannelMixGainPercent";

export type EchoLinkSidebarSection =
  | "audioIn"
  | "monitor"
  | "vocabulary"
  | "chats"
  | "info";

export type EchoLinkAudioInLayoutMode = "mixer" | "detail";

export type EchoLinkAudioInDetailScope =
  | "both"
  | "microphone"
  | "systemAudio"
  | "media";

export type EchoLinkAudioInChannelTab = "microphone" | "systemAudio" | "media";

export type EchoLinkMixerStripId = "ch1" | "ch2" | "ch3" | "output";

export const ECHO_LINK_MIXER_STRIP_ORDER_DEFAULT: EchoLinkMixerStripId[] = [
  "ch1",
  "ch2",
  "ch3",
  "output",
];

export function sanitizeMixerStripOrder(
  raw: unknown
): EchoLinkMixerStripId[] {
  const fallback = [...ECHO_LINK_MIXER_STRIP_ORDER_DEFAULT];
  if (!Array.isArray(raw)) {
    return fallback;
  }
  const seen = new Set<EchoLinkMixerStripId>();
  const out: EchoLinkMixerStripId[] = [];
  for (const x of raw) {
    if (x !== "ch1" && x !== "ch2" && x !== "ch3" && x !== "output") {
      return fallback;
    }
    if (seen.has(x)) {
      continue;
    }
    seen.add(x);
    out.push(x);
  }
  if (out.length === 4 && seen.size === 4) {
    return out;
  }
  if (
    out.length === 3 &&
    seen.has("ch1") &&
    seen.has("ch2") &&
    seen.has("output") &&
    !seen.has("ch3")
  ) {
    const idxOut = out.indexOf("output");
    return [...out.slice(0, idxOut), "ch3", ...out.slice(idxOut)];
  }
  return fallback;
}

export type EchoLinkSettings = {
  audioChunkMs: number;
  transcriptionStartDelayMs: number;
  phraseSilenceCutMs: number;
  inputSensitivity: number;
  inputDeviceAliases: Record<string, string>;
  outputDeviceAliases: Record<string, string>;
  speechReceiveLanguage: string;
  speechTransformLanguage: string;
  speechLanguagesEnabled: boolean;
  selectedInputDeviceId: string;
  selectedSecondaryInputDeviceId: string;
  selectedTertiaryInputDeviceId: string;
  selectedOutputDeviceId: string;
  selectedElevenLabsVoiceId: string;
  voiceTranslationEnabled: boolean;
  pipelineMonitorEnabled: boolean;
  pipelineMonitorGainPercent: number;
  primaryChannelMixGainPercent: number;
  secondaryChannelMixGainPercent: number;
  tertiaryChannelMixGainPercent: number;
  outputChannelMixGainPercent: number;
  sidebarSection: EchoLinkSidebarSection;
  audioInLayoutMode: EchoLinkAudioInLayoutMode;
  audioInDetailScope: EchoLinkAudioInDetailScope;
  audioInChannelTab: EchoLinkAudioInChannelTab;
  mixerChannel1Active: boolean;
  mixerChannel2Active: boolean;
  mixerChannel3Active: boolean;
  mixerChannel1Muted: boolean;
  mixerChannel2Muted: boolean;
  mixerChannel3Muted: boolean;
  mixerOutputMuted: boolean;
  mixerStripOrder: EchoLinkMixerStripId[];
};

export const ECHO_LINK_STORAGE_KEY = "echoLink.settings.v1";

const DEVICE_ID_MAX = 512;
const ELEVEN_LABS_VOICE_ID_MAX = 96;

export const ECHO_LINK_SETTINGS_PLACEHOLDER: EchoLinkSettings = {
  audioChunkMs: 50,
  transcriptionStartDelayMs: 0,
  phraseSilenceCutMs: 0,
  inputSensitivity: 10,
  inputDeviceAliases: {},
  outputDeviceAliases: {},
  speechReceiveLanguage: "pt-BR",
  speechTransformLanguage: "pt-BR",
  speechLanguagesEnabled: false,
  selectedInputDeviceId: "",
  selectedSecondaryInputDeviceId: "",
  selectedTertiaryInputDeviceId: "",
  selectedOutputDeviceId: "",
  selectedElevenLabsVoiceId: "",
  voiceTranslationEnabled: false,
  pipelineMonitorEnabled: false,
  pipelineMonitorGainPercent: 25,
  primaryChannelMixGainPercent: 100,
  secondaryChannelMixGainPercent: 100,
  tertiaryChannelMixGainPercent: 100,
  outputChannelMixGainPercent: 100,
  sidebarSection: "audioIn",
  audioInLayoutMode: "mixer",
  audioInDetailScope: "both",
  audioInChannelTab: "microphone",
  mixerChannel1Active: true,
  mixerChannel2Active: false,
  mixerChannel3Active: false,
  mixerChannel1Muted: false,
  mixerChannel2Muted: false,
  mixerChannel3Muted: false,
  mixerOutputMuted: false,
  mixerStripOrder: [...ECHO_LINK_MIXER_STRIP_ORDER_DEFAULT],
};

function sanitizeDeviceId(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  return raw.length > DEVICE_ID_MAX ? raw.slice(0, DEVICE_ID_MAX) : raw;
}

function sanitizeElevenLabsVoiceId(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const t = raw.trim();
  return t.length > ELEVEN_LABS_VOICE_ID_MAX
    ? t.slice(0, ELEVEN_LABS_VOICE_ID_MAX)
    : t;
}

export const TIMING_DEFAULTS: Record<TimingKey, number> = {
  audioChunkMs: 50,
  transcriptionStartDelayMs: 0,
  phraseSilenceCutMs: 0,
};

const RANGES: Record<EchoLinkSettingsKey, [number, number]> = {
  audioChunkMs: [50, 4000],
  transcriptionStartDelayMs: [0, 15000],
  phraseSilenceCutMs: [0, 15000],
  inputSensitivity: [10, 5000],
  primaryChannelMixGainPercent: [0, 150],
  secondaryChannelMixGainPercent: [0, 150],
  tertiaryChannelMixGainPercent: [0, 150],
  outputChannelMixGainPercent: [0, 150],
};

export function clampEchoLinkSetting(
  key: EchoLinkSettingsKey,
  value: number
): number {
  const [min, max] = RANGES[key];
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampTiming(key: TimingKey, value: number): number {
  return clampEchoLinkSetting(key, value);
}

const ALIAS_VALUE_MAX = 96;
const ALIAS_KEY_MAX = 512;

function sanitizeAliasRecord(
  raw: Record<string, unknown>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(raw)) {
    if (typeof k !== "string" || k.length > ALIAS_KEY_MAX) continue;
    if (typeof val !== "string") continue;
    const t = val.trim().slice(0, ALIAS_VALUE_MAX);
    if (t.length > 0) out[k] = t;
  }
  return out;
}

export function parseEchoLinkSettingsFromServer(raw: unknown): EchoLinkSettings {
  if (raw === null || typeof raw !== "object") {
    return { ...ECHO_LINK_SETTINGS_PLACEHOLDER };
  }
  return mergeEchoLinkSettingsPayload(raw as Record<string, unknown>);
}

function mergeEchoLinkSettingsPayload(
  raw: Partial<Record<string, unknown>>
): EchoLinkSettings {
  const out: EchoLinkSettings = { ...ECHO_LINK_SETTINGS_PLACEHOLDER };
  (Object.keys(ECHO_LINK_SETTINGS_PLACEHOLDER) as (keyof EchoLinkSettings)[]).forEach(
    (key) => {
      const v = raw[key as string];
      if (key === "inputDeviceAliases" || key === "outputDeviceAliases") {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          out[key] = sanitizeAliasRecord(v as Record<string, unknown>);
        }
        return;
      }
      if (key === "speechReceiveLanguage" || key === "speechTransformLanguage") {
        out[key] = sanitizeSpeechLanguageTag(
          v,
          ECHO_LINK_SETTINGS_PLACEHOLDER[key]
        );
        return;
      }
      if (key === "speechLanguagesEnabled") {
        out[key] =
          typeof v === "boolean"
            ? v
            : ECHO_LINK_SETTINGS_PLACEHOLDER.speechLanguagesEnabled;
        return;
      }
      if (key === "sidebarSection") {
        if (
          v === "audioIn" ||
          v === "monitor" ||
          v === "vocabulary" ||
          v === "chats" ||
          v === "info"
        ) {
          out[key] = v;
        }
        return;
      }
      if (key === "audioInLayoutMode") {
        if (v === "mixer" || v === "detail") {
          out[key] = v;
        }
        return;
      }
      if (key === "audioInDetailScope") {
        if (
          v === "both" ||
          v === "microphone" ||
          v === "systemAudio" ||
          v === "media"
        ) {
          out[key] = v;
        }
        return;
      }
      if (key === "audioInChannelTab") {
        if (
          v === "microphone" ||
          v === "systemAudio" ||
          v === "media"
        ) {
          out[key] = v;
        }
        return;
      }
      if (
        key === "mixerChannel1Active" ||
        key === "mixerChannel2Active" ||
        key === "mixerChannel3Active" ||
        key === "mixerChannel1Muted" ||
        key === "mixerChannel2Muted" ||
        key === "mixerChannel3Muted" ||
        key === "mixerOutputMuted"
      ) {
        if (typeof v === "boolean") {
          out[key] = v;
        }
        return;
      }
      if (key === "mixerStripOrder") {
        out[key] = sanitizeMixerStripOrder(v);
        return;
      }
      if (
        key === "selectedInputDeviceId" ||
        key === "selectedSecondaryInputDeviceId" ||
        key === "selectedTertiaryInputDeviceId" ||
        key === "selectedOutputDeviceId"
      ) {
        out[key] = sanitizeDeviceId(v);
        return;
      }
      if (key === "selectedElevenLabsVoiceId") {
        out[key] = sanitizeElevenLabsVoiceId(v);
        return;
      }
      if (key === "voiceTranslationEnabled" || key === "pipelineMonitorEnabled") {
        out[key] =
          typeof v === "boolean"
            ? v
            : ECHO_LINK_SETTINGS_PLACEHOLDER[key];
        return;
      }
      if (key === "pipelineMonitorGainPercent") {
        if (typeof v === "number" && Number.isFinite(v)) {
          out[key] = Math.min(100, Math.max(1, Math.round(v)));
        }
        return;
      }
      if (
        key === "primaryChannelMixGainPercent" ||
        key === "secondaryChannelMixGainPercent" ||
        key === "tertiaryChannelMixGainPercent" ||
        key === "outputChannelMixGainPercent"
      ) {
        if (typeof v === "number" && Number.isFinite(v)) {
          out[key] = clampEchoLinkSetting(key, Math.round(v));
        }
        return;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        out[key] = clampEchoLinkSetting(key as EchoLinkSettingsKey, v);
      }
    }
  );
  return out;
}

function migrateLegacyLocalStorage(): Partial<EchoLinkSettings> | null {
  if (typeof window === "undefined") return null;
  let touched = false;
  const partial: Partial<EchoLinkSettings> = {};
  (Object.keys(TIMING_KEYS) as TimingKey[]).forEach((key) => {
    const raw = window.localStorage.getItem(TIMING_KEYS[key]);
    if (raw === null) return;
    touched = true;
    const n = Number.parseInt(raw, 10);
    partial[key] = clampEchoLinkSetting(key, n);
    window.localStorage.removeItem(TIMING_KEYS[key]);
  });
  return touched ? partial : null;
}

export function loadEchoLinkSettingsFromLocalStorage(): EchoLinkSettings {
  if (typeof window === "undefined") {
    return { ...ECHO_LINK_SETTINGS_PLACEHOLDER };
  }
  const legacy = migrateLegacyLocalStorage();
  const rawJson = window.localStorage.getItem(ECHO_LINK_STORAGE_KEY);
  if (rawJson === null) {
    return legacy
      ? mergeEchoLinkSettingsPayload(legacy)
      : { ...ECHO_LINK_SETTINGS_PLACEHOLDER };
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      return mergeEchoLinkSettingsPayload(legacy ?? {});
    }
    const base = mergeEchoLinkSettingsPayload(parsed as Record<string, unknown>);
    return legacy
      ? mergeEchoLinkSettingsPayload({ ...base, ...legacy })
      : base;
  } catch {
    return mergeEchoLinkSettingsPayload(legacy ?? {});
  }
}

let electronWriteTimer: ReturnType<typeof setTimeout> | null = null;

function writeToElectronImmediate(data: EchoLinkSettings): void {
  if (typeof window === "undefined") return;
  const bridge = (
    window as unknown as {
      echolink?: { writeSettings?: (d: EchoLinkSettings) => Promise<void> };
    }
  ).echolink;
  if (!bridge?.writeSettings) return;
  void bridge.writeSettings(data);
}

function scheduleElectronWrite(data: EchoLinkSettings): void {
  if (typeof window === "undefined") return;
  const bridge = (
    window as unknown as {
      echolink?: { writeSettings?: (d: EchoLinkSettings) => Promise<void> };
    }
  ).echolink;
  if (!bridge?.writeSettings) return;
  if (electronWriteTimer !== null) {
    clearTimeout(electronWriteTimer);
  }
  electronWriteTimer = setTimeout(() => {
    electronWriteTimer = null;
    writeToElectronImmediate(data);
  }, 400);
}

export type SaveEchoLinkSettingsOptions = {
  syncElectron?: boolean;
};

export function saveEchoLinkSettingsToStorage(
  partial: Partial<EchoLinkSettings>,
  options?: SaveEchoLinkSettingsOptions
): void {
  if (typeof window === "undefined") return;
  const prev = loadEchoLinkSettingsFromLocalStorage();
  const next: EchoLinkSettings = { ...prev };
  (Object.entries(partial) as [
    keyof EchoLinkSettings,
    EchoLinkSettings[keyof EchoLinkSettings],
  ][]).forEach(([key, v]) => {
    if (key === "inputDeviceAliases" || key === "outputDeviceAliases") {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        next[key] = sanitizeAliasRecord(v as Record<string, unknown>);
      }
      return;
    }
    if (key === "speechReceiveLanguage" || key === "speechTransformLanguage") {
      if (typeof v === "string") {
        next[key] = sanitizeSpeechLanguageTag(
          v,
          ECHO_LINK_SETTINGS_PLACEHOLDER[key]
        );
      }
      return;
    }
    if (key === "speechLanguagesEnabled") {
      if (typeof v === "boolean") {
        next[key] = v;
      }
      return;
    }
    if (key === "sidebarSection") {
      if (
        v === "audioIn" ||
        v === "monitor" ||
        v === "vocabulary" ||
        v === "chats" ||
        v === "info"
      ) {
        next[key] = v;
      }
      return;
    }
    if (key === "audioInLayoutMode") {
      if (v === "mixer" || v === "detail") {
        next[key] = v;
      }
      return;
    }
    if (key === "audioInDetailScope") {
      if (
        v === "both" ||
        v === "microphone" ||
        v === "systemAudio" ||
        v === "media"
      ) {
        next[key] = v;
      }
      return;
    }
    if (key === "audioInChannelTab") {
      if (v === "microphone" || v === "systemAudio" || v === "media") {
        next[key] = v;
      }
      return;
    }
    if (
      key === "mixerChannel1Active" ||
      key === "mixerChannel2Active" ||
      key === "mixerChannel3Active" ||
      key === "mixerChannel1Muted" ||
      key === "mixerChannel2Muted" ||
      key === "mixerChannel3Muted" ||
      key === "mixerOutputMuted"
    ) {
      if (typeof v === "boolean") {
        next[key] = v;
      }
      return;
    }
    if (key === "mixerStripOrder") {
      next[key] = sanitizeMixerStripOrder(v);
      return;
    }
    if (
      key === "selectedInputDeviceId" ||
      key === "selectedSecondaryInputDeviceId" ||
      key === "selectedTertiaryInputDeviceId" ||
      key === "selectedOutputDeviceId"
    ) {
      if (typeof v === "string") {
        next[key] = sanitizeDeviceId(v);
      }
      return;
    }
    if (key === "selectedElevenLabsVoiceId") {
      if (typeof v === "string") {
        next[key] = sanitizeElevenLabsVoiceId(v);
      }
      return;
    }
    if (key === "voiceTranslationEnabled" || key === "pipelineMonitorEnabled") {
      if (typeof v === "boolean") {
        next[key] = v;
      }
      return;
    }
    if (key === "pipelineMonitorGainPercent") {
      if (typeof v === "number" && Number.isFinite(v)) {
        next[key] = Math.min(100, Math.max(1, Math.round(v)));
      }
      return;
    }
    if (
      key === "primaryChannelMixGainPercent" ||
      key === "secondaryChannelMixGainPercent" ||
      key === "tertiaryChannelMixGainPercent" ||
      key === "outputChannelMixGainPercent"
    ) {
      if (typeof v === "number" && Number.isFinite(v)) {
        next[key] = clampEchoLinkSetting(key, Math.round(v));
      }
      return;
    }
    if (typeof v === "number") {
      next[key] = clampEchoLinkSetting(key as EchoLinkSettingsKey, v);
    }
  });
  window.localStorage.setItem(ECHO_LINK_STORAGE_KEY, JSON.stringify(next));
  const patchKeys = Object.keys(partial) as (keyof EchoLinkSettings)[];
  if (patchKeys.length > 0) {
    const body: Partial<EchoLinkSettings> = {};
    patchKeys.forEach((k) => {
      Object.assign(body, { [k]: next[k] } as Partial<EchoLinkSettings>);
    });
    void import("./echoLinkServerConfig").then((m) =>
      m.pushEchoLinkServerConfigPatch(body)
    );
  }
  if (options?.syncElectron) {
    if (electronWriteTimer !== null) {
      clearTimeout(electronWriteTimer);
      electronWriteTimer = null;
    }
    writeToElectronImmediate(next);
  } else {
    scheduleElectronWrite(next);
  }
}

export function saveEchoLinkSpeechSettings(
  patch: Partial<
    Pick<
      EchoLinkSettings,
      | "speechLanguagesEnabled"
      | "speechReceiveLanguage"
      | "speechTransformLanguage"
    >
  >
): void {
  const prev = loadEchoLinkSettingsFromLocalStorage();
  const speechReceiveLanguage = sanitizeSpeechLanguageTag(
    patch.speechReceiveLanguage ?? prev.speechReceiveLanguage,
    ECHO_LINK_SETTINGS_PLACEHOLDER.speechReceiveLanguage
  );
  const speechTransformLanguage = sanitizeSpeechLanguageTag(
    patch.speechTransformLanguage ?? prev.speechTransformLanguage,
    ECHO_LINK_SETTINGS_PLACEHOLDER.speechTransformLanguage
  );
  const speechLanguagesEnabled =
    typeof patch.speechLanguagesEnabled === "boolean"
      ? patch.speechLanguagesEnabled
      : prev.speechLanguagesEnabled;
  saveEchoLinkSettingsToStorage(
    {
      speechReceiveLanguage,
      speechTransformLanguage,
      speechLanguagesEnabled,
    },
    { syncElectron: true }
  );
}

export async function hydrateEchoLinkSettingsFromElectron(): Promise<EchoLinkSettings | null> {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as unknown as {
      echolink?: { readSettings?: () => Promise<unknown> };
    }
  ).echolink;
  if (!bridge?.readSettings) return null;
  try {
    const raw = await bridge.readSettings();
    if (raw === null || typeof raw !== "object") return null;
    const merged = mergeEchoLinkSettingsPayload(raw as Record<string, unknown>);
    window.localStorage.setItem(ECHO_LINK_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return null;
  }
}
