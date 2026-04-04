import { sanitizeSpeechLanguageTag } from "./speechLanguages";

export const TIMING_KEYS = {
  audioChunkMs: "echoLink.audioChunkMs",
  transcriptionStartDelayMs: "echoLink.transcriptionStartDelayMs",
  phraseSilenceCutMs: "echoLink.phraseSilenceCutMs",
} as const;

export type TimingKey = keyof typeof TIMING_KEYS;

export type EchoLinkSettingsKey =
  | TimingKey
  | "inputSensitivity";

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
};

export const ECHO_LINK_STORAGE_KEY = "echoLink.settings.v1";

export const ECHO_LINK_SETTINGS_DEFAULTS: EchoLinkSettings = {
  audioChunkMs: 250,
  transcriptionStartDelayMs: 0,
  phraseSilenceCutMs: 1200,
  inputSensitivity: 100,
  inputDeviceAliases: {},
  outputDeviceAliases: {},
  speechReceiveLanguage: "pt-BR",
  speechTransformLanguage: "pt-BR",
  speechLanguagesEnabled: true,
};

export const TIMING_DEFAULTS: Record<TimingKey, number> = {
  audioChunkMs: ECHO_LINK_SETTINGS_DEFAULTS.audioChunkMs,
  transcriptionStartDelayMs:
    ECHO_LINK_SETTINGS_DEFAULTS.transcriptionStartDelayMs,
  phraseSilenceCutMs: ECHO_LINK_SETTINGS_DEFAULTS.phraseSilenceCutMs,
};

const RANGES: Record<EchoLinkSettingsKey, [number, number]> = {
  audioChunkMs: [50, 4000],
  transcriptionStartDelayMs: [0, 15000],
  phraseSilenceCutMs: [0, 15000],
  inputSensitivity: [10, 400],
};

export function clampEchoLinkSetting(
  key: EchoLinkSettingsKey,
  value: number
): number {
  const [min, max] = RANGES[key];
  if (Number.isNaN(value)) {
    return key === "inputSensitivity"
      ? ECHO_LINK_SETTINGS_DEFAULTS.inputSensitivity
      : TIMING_DEFAULTS[key as TimingKey];
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

function mergeWithDefaults(raw: Partial<Record<string, unknown>>): EchoLinkSettings {
  const out: EchoLinkSettings = { ...ECHO_LINK_SETTINGS_DEFAULTS };
  (Object.keys(ECHO_LINK_SETTINGS_DEFAULTS) as (keyof EchoLinkSettings)[]).forEach(
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
          ECHO_LINK_SETTINGS_DEFAULTS[key]
        );
        return;
      }
      if (key === "speechLanguagesEnabled") {
        out[key] =
          typeof v === "boolean"
            ? v
            : ECHO_LINK_SETTINGS_DEFAULTS.speechLanguagesEnabled;
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
    return { ...ECHO_LINK_SETTINGS_DEFAULTS };
  }
  const legacy = migrateLegacyLocalStorage();
  const rawJson = window.localStorage.getItem(ECHO_LINK_STORAGE_KEY);
  if (rawJson === null) {
    return legacy ? mergeWithDefaults(legacy) : { ...ECHO_LINK_SETTINGS_DEFAULTS };
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (parsed === null || typeof parsed !== "object") {
      return mergeWithDefaults(legacy ?? {});
    }
    const base = mergeWithDefaults(parsed as Record<string, unknown>);
    return legacy ? mergeWithDefaults({ ...base, ...legacy }) : base;
  } catch {
    return mergeWithDefaults(legacy ?? {});
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
          ECHO_LINK_SETTINGS_DEFAULTS[key]
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
    if (typeof v === "number") {
      next[key] = clampEchoLinkSetting(key as EchoLinkSettingsKey, v);
    }
  });
  window.localStorage.setItem(ECHO_LINK_STORAGE_KEY, JSON.stringify(next));
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
    ECHO_LINK_SETTINGS_DEFAULTS.speechReceiveLanguage
  );
  const speechTransformLanguage = sanitizeSpeechLanguageTag(
    patch.speechTransformLanguage ?? prev.speechTransformLanguage,
    ECHO_LINK_SETTINGS_DEFAULTS.speechTransformLanguage
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
    const merged = mergeWithDefaults(raw as Record<string, unknown>);
    window.localStorage.setItem(ECHO_LINK_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return null;
  }
}
