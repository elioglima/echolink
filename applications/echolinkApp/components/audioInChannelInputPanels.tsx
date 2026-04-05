"use client";

import {
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  type EchoLinkSettings,
  type EchoLinkSettingsKey,
  saveEchoLinkSettingsToStorage,
  saveEchoLinkSpeechSettings,
} from "../lib/echoLinkSettings";
import { formatMediaDeviceOptionLabel } from "../lib/mediaDeviceOptionLabel";
import { SPEECH_LANGUAGE_OPTIONS } from "../lib/speechLanguages";
import { timingRangeProgress } from "../lib/timingRangeProgress";
import type { VoiceTranslationStatus } from "../lib/voiceTranslationClient";

const MIX_FADER_MAX = 150;
const CHUNK_MS_MIN = 50;
const CHUNK_MS_MAX = 4000;
const CUT_MS_MAX = 15000;
const INPUT_SENS_MIN = 10;
const INPUT_SENS_MAX = 5000;

type AudioInDetailScope = "both" | "microphone" | "systemAudio" | "media";

export type AudioInMicInputPanelProps = {
  embedded: boolean;
  audioInDetailScope: AudioInDetailScope;
  settings: EchoLinkSettings;
  setSettings: Dispatch<SetStateAction<EchoLinkSettings>>;
  selectedInputId: string;
  setSelectedInputId: (v: string) => void;
  selectedSecondaryInputId: string;
  selectedTertiaryInputId: string;
  setSelectedSecondaryInputId: (v: string) => void;
  setSelectedTertiaryInputId: (v: string) => void;
  audioInputs: MediaDeviceInfo[];
  busy: boolean;
  micTesting: boolean;
  outputTesting: boolean;
  meterSampleRate: number;
  selectClass: string;
  btnSky: string;
  setSettingsField: (key: EchoLinkSettingsKey, raw: string) => void;
  testMicrophone: () => void | Promise<void>;
  elevenLabsVoiceSelectOptions: { value: string; label: string }[];
  elevenLabsVoiceSelectUiValue: string;
  elevenLabsVoicesLoading: boolean;
  voiceTranslationEnabled: boolean;
  setVoiceTranslationEnabled: Dispatch<SetStateAction<boolean>>;
  voiceTranslationBackendStatus: VoiceTranslationStatus | null;
};

export function AudioInMicInputDetailPanel(props: AudioInMicInputPanelProps) {
  const {
    embedded,
    audioInDetailScope,
    settings,
    setSettings,
    selectedInputId,
    setSelectedInputId,
    selectedSecondaryInputId,
    selectedTertiaryInputId,
    setSelectedSecondaryInputId,
    setSelectedTertiaryInputId,
    audioInputs,
    busy,
    micTesting,
    outputTesting,
    meterSampleRate,
    selectClass,
    btnSky,
    setSettingsField,
    testMicrophone,
    elevenLabsVoiceSelectOptions,
    elevenLabsVoiceSelectUiValue,
    elevenLabsVoicesLoading,
    voiceTranslationEnabled,
    setVoiceTranslationEnabled,
    voiceTranslationBackendStatus,
  } = props;

  return (
    <section
      role="tabpanel"
      aria-labelledby={
        !embedded && audioInDetailScope === "both"
          ? "audio-in-tab-mic"
          : undefined
      }
      aria-label={
        !embedded && audioInDetailScope === "both"
          ? undefined
          : "Microfone · canal de entrada 1"
      }
      className="bg-zinc-900/50 p-3 sm:p-4"
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-md bg-sky-950/25 px-2 py-1.5 ring-1 ring-sky-700/35">
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sky-300 sm:text-[10px] sm:tracking-[0.2em]">
          Canal de entrada 1
        </span>
        <span className="text-[9px] text-zinc-400">Microfone</span>
      </div>
      <label
        htmlFor="echo-input-device"
        className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
      >
        Dispositivo deste canal
      </label>
      <select
        id="echo-input-device"
        className={selectClass}
        disabled={busy}
        value={selectedInputId}
        onChange={(e) => {
          const v = e.target.value;
          setSelectedInputId(v);
          const patch: Partial<EchoLinkSettings> = {
            selectedInputDeviceId: v,
          };
          if (v && v === selectedSecondaryInputId) {
            setSelectedSecondaryInputId("");
            patch.selectedSecondaryInputDeviceId = "";
          }
          if (v && v === selectedTertiaryInputId) {
            patch.selectedTertiaryInputDeviceId = "";
            setSelectedTertiaryInputId("");
          }
          setSettings((prev) => ({ ...prev, ...patch }));
          saveEchoLinkSettingsToStorage(patch);
        }}
      >
        <option value="">Principal / padrão</option>
        {audioInputs.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {formatMediaDeviceOptionLabel(
              d,
              "input",
              settings.inputDeviceAliases[d.deviceId]
            )}
          </option>
        ))}
      </select>
      <div className="mt-3 space-y-2">
        <div className="flex items-end justify-between gap-2">
          <label
            htmlFor="detail-ch1-mix-gain"
            className="text-[9px] uppercase tracking-wider text-zinc-500"
          >
            Nível na mesa (%)
          </label>
          <span className="tabular-nums text-[10px] text-zinc-400">
            {settings.primaryChannelMixGainPercent}%
          </span>
        </div>
        <input
          id="detail-ch1-mix-gain"
          type="range"
          min={0}
          max={MIX_FADER_MAX}
          step={1}
          disabled={busy}
          value={settings.primaryChannelMixGainPercent}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            setSettings((prev) => ({
              ...prev,
              primaryChannelMixGainPercent: v,
            }));
            saveEchoLinkSettingsToStorage({
              primaryChannelMixGainPercent: v,
            });
          }}
          className="echo-range h-6 w-full cursor-pointer"
          style={
            {
              "--range-progress": timingRangeProgress(
                settings.primaryChannelMixGainPercent,
                0,
                MIX_FADER_MAX
              ),
            } as CSSProperties
          }
        />
        <p className="text-[9px] leading-snug text-zinc-600">
          Ganho do canal na mistura enviada ao serviço (0–150%).
        </p>
      </div>
      <div className="mt-4 border-t border-zinc-600/35 pt-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
          Captura · medidor e tempo
        </p>
        <p className="mb-3 text-[9px] leading-snug text-zinc-500">
          Canal 1 (microfone): sensibilidade do VU, blocos ao serviço e corte do
          texto no visor. Valores salvos automaticamente.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="entrada-input-sensitivity"
                className="text-[9px] uppercase tracking-wider text-zinc-500"
              >
                Sensibilidade de entrada (%)
              </label>
              <span className="tabular-nums text-[10px] text-zinc-400">
                {settings.inputSensitivity}%
              </span>
            </div>
            <input
              id="entrada-input-sensitivity"
              type="range"
              min={INPUT_SENS_MIN}
              max={INPUT_SENS_MAX}
              step={5}
              disabled={micTesting || outputTesting}
              value={settings.inputSensitivity}
              onChange={(e) =>
                setSettingsField("inputSensitivity", e.target.value)
              }
              className="echo-range h-6 w-full cursor-pointer"
              style={
                {
                  "--range-progress": timingRangeProgress(
                    settings.inputSensitivity,
                    INPUT_SENS_MIN,
                    INPUT_SENS_MAX
                  ),
                } as CSSProperties
              }
            />
            <p className="text-[9px] leading-snug text-zinc-600">
              Ganho do medidor de microfone (100% = padrão).
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="entrada-chunk-ms"
                className="text-[9px] uppercase tracking-wider text-zinc-500"
              >
                Tempo de entrada (ms)
              </label>
              <span className="tabular-nums text-[10px] text-zinc-400">
                {settings.audioChunkMs} ms
              </span>
            </div>
            <input
              id="entrada-chunk-ms"
              type="range"
              min={CHUNK_MS_MIN}
              max={CHUNK_MS_MAX}
              step={10}
              disabled={micTesting || outputTesting}
              value={settings.audioChunkMs}
              onChange={(e) =>
                setSettingsField("audioChunkMs", e.target.value)
              }
              className="echo-range h-6 w-full cursor-pointer"
              style={
                {
                  "--range-progress": timingRangeProgress(
                    settings.audioChunkMs,
                    CHUNK_MS_MIN,
                    CHUNK_MS_MAX
                  ),
                } as CSSProperties
              }
            />
            <p className="text-[9px] leading-snug text-zinc-600">
              Duração de cada bloco enviado ao serviço. Vale na próxima captura
              ou ao reiniciar.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="entrada-stt-delay-ms"
                className="text-[9px] uppercase tracking-wider text-zinc-500"
              >
                Atraso início texto (ms)
              </label>
              <span className="tabular-nums text-[10px] text-zinc-400">
                {settings.transcriptionStartDelayMs} ms
              </span>
            </div>
            <input
              id="entrada-stt-delay-ms"
              type="range"
              min={0}
              max={CUT_MS_MAX}
              step={50}
              disabled={micTesting || outputTesting}
              value={settings.transcriptionStartDelayMs}
              onChange={(e) =>
                setSettingsField(
                  "transcriptionStartDelayMs",
                  e.target.value
                )
              }
              className="echo-range h-6 w-full cursor-pointer"
              style={
                {
                  "--range-progress": timingRangeProgress(
                    settings.transcriptionStartDelayMs,
                    0,
                    CUT_MS_MAX
                  ),
                } as CSSProperties
              }
            />
            <p className="text-[9px] leading-snug text-zinc-600">
              Espera antes de ligar o reconhecimento de voz após iniciar a
              captura.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="entrada-cut-ms"
                className="text-[9px] uppercase tracking-wider text-zinc-500"
              >
                Corte em tempo real (ms)
              </label>
              <span className="tabular-nums text-[10px] text-zinc-400">
                {settings.phraseSilenceCutMs} ms
              </span>
            </div>
            <input
              id="entrada-cut-ms"
              type="range"
              min={0}
              max={CUT_MS_MAX}
              step={50}
              disabled={micTesting || outputTesting}
              value={settings.phraseSilenceCutMs}
              onChange={(e) =>
                setSettingsField("phraseSilenceCutMs", e.target.value)
              }
              className="echo-range h-6 w-full cursor-pointer"
              style={
                {
                  "--range-progress": timingRangeProgress(
                    settings.phraseSilenceCutMs,
                    0,
                    CUT_MS_MAX
                  ),
                } as CSSProperties
              }
            />
            <p className="text-[9px] leading-snug text-zinc-600">
              Silêncio após texto provisório para fechar linha no chat. Pode
              ajustar com a captura ligada.
            </p>
          </div>
          <dl className="border-t border-zinc-700/40 pt-3">
            <div className="flex justify-between gap-2 text-[10px] text-zinc-400">
              <dt>Taxa de amostragem</dt>
              <dd className="tabular-nums text-zinc-300">
                {meterSampleRate > 0 ? `${meterSampleRate} Hz` : "—"}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="mt-4 border-t border-zinc-600/35 pt-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
            Tradutor · idioma e tradução
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={settings.speechLanguagesEnabled}
            aria-label="Ativar tradução e idiomas"
            disabled={busy}
            onClick={() => {
              const next = !settings.speechLanguagesEnabled;
              setSettings((prev) => {
                const merged = {
                  ...prev,
                  speechLanguagesEnabled: next,
                };
                saveEchoLinkSpeechSettings({
                  speechLanguagesEnabled: next,
                  speechReceiveLanguage: prev.speechReceiveLanguage,
                  speechTransformLanguage: prev.speechTransformLanguage,
                });
                return merged;
              });
            }}
            className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              settings.speechLanguagesEnabled
                ? "border-sky-500/80 bg-sky-600/90"
                : "border-zinc-600 bg-zinc-700"
            }`}
          >
            <span
              className={`pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                settings.speechLanguagesEnabled
                  ? "translate-x-5"
                  : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <p className="mb-3 text-[9px] leading-snug text-zinc-500">
          Definições deste canal (entrada 1 · microfone): idioma da fala e
          alvo do texto na captura. A mistura ativa na mesa é que segue para o
          STT. Desligado: só português (Brasil) no reconhecimento.
        </p>
        <div
          className={`space-y-4 ${
            !settings.speechLanguagesEnabled
              ? "pointer-events-none opacity-45"
              : ""
          }`}
        >
          <div>
            <label
              htmlFor="echo-mic-speech-receive-lang"
              className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
            >
              Receber fala
            </label>
            <select
              id="echo-mic-speech-receive-lang"
              className={selectClass}
              disabled={busy || !settings.speechLanguagesEnabled}
              value={settings.speechReceiveLanguage}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((prev) => {
                  const next = {
                    ...prev,
                    speechReceiveLanguage: v,
                  };
                  saveEchoLinkSpeechSettings({
                    speechReceiveLanguage: v,
                    speechLanguagesEnabled: prev.speechLanguagesEnabled,
                    speechTransformLanguage: prev.speechTransformLanguage,
                  });
                  return next;
                });
              }}
            >
              {SPEECH_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="echo-mic-speech-transform-lang"
              className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
            >
              Transformar para
            </label>
            <select
              id="echo-mic-speech-transform-lang"
              className={selectClass}
              disabled={busy || !settings.speechLanguagesEnabled}
              value={settings.speechTransformLanguage}
              onChange={(e) => {
                const v = e.target.value;
                setSettings((prev) => {
                  const next = {
                    ...prev,
                    speechTransformLanguage: v,
                  };
                  saveEchoLinkSpeechSettings({
                    speechTransformLanguage: v,
                    speechLanguagesEnabled: prev.speechLanguagesEnabled,
                    speechReceiveLanguage: prev.speechReceiveLanguage,
                  });
                  return next;
                });
              }}
            >
              {SPEECH_LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label
            htmlFor="echo-mic-eleven-voice"
            className="mb-1.5 block text-[8px] font-bold uppercase tracking-[0.16em] text-emerald-600/95"
          >
            Voz em inglês (ElevenLabs)
          </label>
          {elevenLabsVoicesLoading ? (
            <p className="text-[9px] text-zinc-500">
              A carregar vozes da conta…
            </p>
          ) : (
            <>
              <select
                id="echo-mic-eleven-voice"
                className={selectClass}
                disabled={busy || elevenLabsVoiceSelectOptions.length === 0}
                value={elevenLabsVoiceSelectUiValue}
                onChange={(e) => {
                  const v = e.target.value;
                  setSettings((prev) => {
                    const next = {
                      ...prev,
                      selectedElevenLabsVoiceId: v,
                    };
                    saveEchoLinkSettingsToStorage({
                      selectedElevenLabsVoiceId: v,
                    });
                    return next;
                  });
                }}
              >
                {elevenLabsVoiceSelectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[9px] leading-snug text-zinc-500">
                Lista vinda da API ElevenLabs com a voz em inglês ativa; senão,
                opções de reserva.
              </p>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 border-t border-zinc-600/35 pt-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            Voz em inglês (nuvem)
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-emerald-500"
              checked={voiceTranslationEnabled}
              disabled={busy}
              onChange={(e) => {
                const c = e.target.checked;
                setVoiceTranslationEnabled(c);
                setSettings((prev) => ({
                  ...prev,
                  voiceTranslationEnabled: c,
                }));
                saveEchoLinkSettingsToStorage(
                  { voiceTranslationEnabled: c },
                  { syncElectron: true }
                );
              }}
            />
            Ativar
          </label>
        </div>
        <p className="mb-2 text-[9px] leading-snug text-zinc-500">
          A cada frase final do STT: Amazon Translate (PT→EN) + ElevenLabs (voz
          clonada). Reproduz no dispositivo de saída (Controles · faixa Saída).
        </p>
        {voiceTranslationEnabled && (
          <p className="mb-2 text-[10px] text-zinc-400">
            Serviço:{" "}
            {voiceTranslationBackendStatus?.ready
              ? "pronto"
              : voiceTranslationBackendStatus === null
                ? "…"
                : "incompleto (AWS + ELEVENLABS_*)"}
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 sm:gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void testMicrophone()}
          className={btnSky}
        >
          {micTesting ? "…" : "Testar mic"}
        </button>
      </div>
    </section>
  );
}

export type AudioInLineInputPanelProps = {
  embedded: boolean;
  audioInDetailScope: AudioInDetailScope;
  settings: EchoLinkSettings;
  setSettings: Dispatch<SetStateAction<EchoLinkSettings>>;
  selectedInputId: string;
  selectedSecondaryInputId: string;
  selectedTertiaryInputId: string;
  setSelectedSecondaryInputId: (v: string) => void;
  setSelectedTertiaryInputId: (v: string) => void;
  audioInputs: MediaDeviceInfo[];
  busy: boolean;
  selectClass: string;
  previewVuLevel: number;
};

export function AudioInLineInputDetailPanel(props: AudioInLineInputPanelProps) {
  const {
    embedded,
    audioInDetailScope,
    settings,
    setSettings,
    selectedInputId,
    selectedSecondaryInputId,
    selectedTertiaryInputId,
    setSelectedSecondaryInputId,
    setSelectedTertiaryInputId,
    audioInputs,
    busy,
    selectClass,
    previewVuLevel,
  } = props;

  const lineChannelOff =
    !selectedSecondaryInputId ||
    selectedSecondaryInputId === selectedInputId;

  return (
    <section
      role="tabpanel"
      aria-labelledby={
        !embedded && audioInDetailScope === "both"
          ? "audio-in-tab-audio"
          : undefined
      }
      aria-label={
        !embedded && audioInDetailScope === "both"
          ? undefined
          : "Entrada adicional · canal de entrada 2"
      }
      className="bg-zinc-900/50 p-3 sm:p-4"
    >
      <div
        className={
          lineChannelOff
            ? "mb-2.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-950/30 px-2 py-1.5 ring-1 ring-amber-500/45"
            : "mb-2.5 flex flex-wrap items-center gap-2 rounded-md bg-emerald-950/25 px-2 py-1.5 ring-1 ring-emerald-700/35"
        }
      >
        <span
          className={
            lineChannelOff
              ? "text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200 sm:text-[10px] sm:tracking-[0.2em]"
              : "text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-300 sm:text-[10px] sm:tracking-[0.2em]"
          }
        >
          Teams · entrada 2
        </span>
        <span className="text-[9px] text-zinc-400">
          Microsoft Teams, apps, loopback
        </span>
      </div>
      <p className="mb-2 text-[9px] leading-snug text-zinc-500">
        Canal opcional. Misturado ao microfone na captura (STT e fluxo ao
        serviço). Use para capturar o Teams (dispositivo de áudio do Teams ou
        agregado no macOS), outras apps ou loopback virtual quando não couber na
        entrada Mídia.
      </p>
      <label
        htmlFor="echo-input-device-2"
        className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
      >
        Dispositivo deste canal
      </label>
      <select
        id="echo-input-device-2"
        className={selectClass}
        disabled={busy}
        value={selectedSecondaryInputId}
        onChange={(e) => {
          const v = e.target.value;
          if (v && v === selectedInputId) {
            return;
          }
          setSelectedSecondaryInputId(v);
          const patch: Partial<EchoLinkSettings> = {
            selectedSecondaryInputDeviceId: v,
          };
          if (v && v === selectedTertiaryInputId) {
            patch.selectedTertiaryInputDeviceId = "";
            setSelectedTertiaryInputId("");
          }
          setSettings((prev) => ({ ...prev, ...patch }));
          saveEchoLinkSettingsToStorage(patch);
        }}
      >
        <option value="">Canal desligado</option>
        {audioInputs.map((d) => (
          <option
            key={d.deviceId}
            value={d.deviceId}
            disabled={
              d.deviceId === selectedInputId ||
              d.deviceId === selectedTertiaryInputId
            }
          >
            {formatMediaDeviceOptionLabel(
              d,
              "input",
              settings.inputDeviceAliases[d.deviceId]
            )}
          </option>
        ))}
      </select>
      {selectedSecondaryInputId &&
        selectedSecondaryInputId !== selectedInputId && (
          <div className="mt-3">
            <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-zinc-500">
              Nível do sinal (monitor)
            </p>
            <div
              className="relative h-3 overflow-hidden rounded-sm bg-zinc-950 shadow-[inset_0_0_8px_rgba(0,0,0,0.85)] ring-1 ring-zinc-700/70"
              aria-hidden
            >
              <div
                className="absolute bottom-0 left-0 top-0 bg-linear-to-r from-emerald-600 via-amber-400 to-red-500 opacity-[0.88] transition-[width] duration-75 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, previewVuLevel * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      <div className="mt-3 space-y-2">
        <div className="flex items-end justify-between gap-2">
          <label
            htmlFor="detail-ch2-mix-gain"
            className="text-[9px] uppercase tracking-wider text-zinc-500"
          >
            Nível na mesa (%)
          </label>
          <span className="tabular-nums text-[10px] text-zinc-400">
            {settings.secondaryChannelMixGainPercent}%
          </span>
        </div>
        <input
          id="detail-ch2-mix-gain"
          type="range"
          min={0}
          max={MIX_FADER_MAX}
          step={1}
          disabled={
            busy ||
            !selectedSecondaryInputId ||
            selectedSecondaryInputId === selectedInputId
          }
          value={settings.secondaryChannelMixGainPercent}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            setSettings((prev) => ({
              ...prev,
              secondaryChannelMixGainPercent: v,
            }));
            saveEchoLinkSettingsToStorage({
              secondaryChannelMixGainPercent: v,
            });
          }}
          className="echo-range h-6 w-full cursor-pointer"
          style={
            {
              "--range-progress": timingRangeProgress(
                settings.secondaryChannelMixGainPercent,
                0,
                MIX_FADER_MAX
              ),
            } as CSSProperties
          }
        />
        <p className="text-[9px] leading-snug text-zinc-600">
          Ganho do canal 2 na mistura (ativo com segundo dispositivo).
        </p>
      </div>
      <p className="mt-3 text-[9px] leading-snug text-zinc-500">
        Blocos PCM, início do STT e corte no visor seguem os tempos do canal 1.
        O medidor acima segue este dispositivo quando o canal está ativo na mesa
        (sem mudo).
      </p>
    </section>
  );
}

export type AudioInMediaInputPanelProps = {
  embedded: boolean;
  audioInDetailScope: AudioInDetailScope;
  settings: EchoLinkSettings;
  setSettings: Dispatch<SetStateAction<EchoLinkSettings>>;
  selectedInputId: string;
  selectedSecondaryInputId: string;
  selectedTertiaryInputId: string;
  setSelectedTertiaryInputId: (v: string) => void;
  audioInputs: MediaDeviceInfo[];
  busy: boolean;
  selectClass: string;
  previewVuLevel: number;
};

export function AudioInMediaInputDetailPanel(props: AudioInMediaInputPanelProps) {
  const {
    embedded,
    audioInDetailScope,
    settings,
    setSettings,
    selectedInputId,
    selectedSecondaryInputId,
    selectedTertiaryInputId,
    setSelectedTertiaryInputId,
    audioInputs,
    busy,
    selectClass,
    previewVuLevel,
  } = props;

  const mediaChannelOff =
    !selectedTertiaryInputId ||
    selectedTertiaryInputId === selectedInputId ||
    selectedTertiaryInputId === selectedSecondaryInputId;

  return (
    <section
      role="tabpanel"
      aria-labelledby={
        !embedded && audioInDetailScope === "both"
          ? "audio-in-tab-media"
          : undefined
      }
      aria-label={
        !embedded && audioInDetailScope === "both"
          ? undefined
          : "Entrada mídia · canal de entrada 3"
      }
      className="bg-zinc-900/50 p-3 sm:p-4"
    >
      <div
        className={
          mediaChannelOff
            ? "mb-2.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-950/35 px-2 py-1.5 ring-1 ring-amber-400/55"
            : "mb-2.5 flex flex-wrap items-center gap-2 rounded-md bg-amber-950/25 px-2 py-1.5 ring-1 ring-amber-700/35"
        }
      >
        <span
          className={
            mediaChannelOff
              ? "text-[9px] font-bold uppercase tracking-[0.18em] text-amber-200 sm:text-[10px] sm:tracking-[0.2em]"
              : "text-[9px] font-bold uppercase tracking-[0.18em] text-amber-300 sm:text-[10px] sm:tracking-[0.2em]"
          }
        >
          Canal de entrada 3
        </span>
        <span className="text-[9px] text-zinc-400">Mídia</span>
      </div>
      <p className="mb-2 text-[9px] leading-snug text-zinc-500">
        Terceira entrada opcional (ex.: outro virtual, leitor ou app). Misturada
        aos canais 1 e 2 na captura. Não pode repetir o mesmo dispositivo dos
        outros canais.
      </p>
      <label
        htmlFor="echo-input-device-3"
        className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
      >
        Dispositivo deste canal
      </label>
      <select
        id="echo-input-device-3"
        className={selectClass}
        disabled={busy}
        value={selectedTertiaryInputId}
        onChange={(e) => {
          const v = e.target.value;
          if (
            v &&
            (v === selectedInputId || v === selectedSecondaryInputId)
          ) {
            return;
          }
          setSelectedTertiaryInputId(v);
          setSettings((prev) => ({
            ...prev,
            selectedTertiaryInputDeviceId: v,
          }));
          saveEchoLinkSettingsToStorage({
            selectedTertiaryInputDeviceId: v,
          });
        }}
      >
        <option value="">Canal desligado</option>
        {audioInputs.map((d) => (
          <option
            key={d.deviceId}
            value={d.deviceId}
            disabled={
              d.deviceId === selectedInputId ||
              d.deviceId === selectedSecondaryInputId
            }
          >
            {formatMediaDeviceOptionLabel(
              d,
              "input",
              settings.inputDeviceAliases[d.deviceId]
            )}
          </option>
        ))}
      </select>
      {selectedTertiaryInputId &&
        selectedTertiaryInputId !== selectedInputId &&
        selectedTertiaryInputId !== selectedSecondaryInputId && (
          <div className="mt-3">
            <p className="mb-1 text-[9px] uppercase tracking-[0.18em] text-zinc-500">
              Nível do sinal (monitor)
            </p>
            <div
              className="relative h-3 overflow-hidden rounded-sm bg-zinc-950 shadow-[inset_0_0_8px_rgba(0,0,0,0.85)] ring-1 ring-zinc-700/70"
              aria-hidden
            >
              <div
                className="absolute bottom-0 left-0 top-0 bg-linear-to-r from-amber-700 via-amber-400 to-orange-500 opacity-[0.88] transition-[width] duration-75 ease-out"
                style={{
                  width: `${Math.min(100, Math.max(0, previewVuLevel * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      <div className="mt-3 space-y-2">
        <div className="flex items-end justify-between gap-2">
          <label
            htmlFor="detail-ch3-mix-gain"
            className="text-[9px] uppercase tracking-wider text-zinc-500"
          >
            Nível na mesa (%)
          </label>
          <span className="tabular-nums text-[10px] text-zinc-400">
            {settings.tertiaryChannelMixGainPercent}%
          </span>
        </div>
        <input
          id="detail-ch3-mix-gain"
          type="range"
          min={0}
          max={MIX_FADER_MAX}
          step={1}
          disabled={
            busy ||
            !selectedTertiaryInputId ||
            selectedTertiaryInputId === selectedInputId ||
            selectedTertiaryInputId === selectedSecondaryInputId
          }
          value={settings.tertiaryChannelMixGainPercent}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            setSettings((prev) => ({
              ...prev,
              tertiaryChannelMixGainPercent: v,
            }));
            saveEchoLinkSettingsToStorage({
              tertiaryChannelMixGainPercent: v,
            });
          }}
          className="echo-range h-6 w-full cursor-pointer"
          style={
            {
              "--range-progress": timingRangeProgress(
                settings.tertiaryChannelMixGainPercent,
                0,
                MIX_FADER_MAX
              ),
            } as CSSProperties
          }
        />
        <p className="text-[9px] leading-snug text-zinc-600">
          Ganho do canal 3 (mídia) na mistura.
        </p>
      </div>
      <p className="mt-3 text-[9px] leading-snug text-zinc-500">
        Tempos de bloco e STT seguem o canal 1. O medidor segue este dispositivo
        quando o canal está ativo na mesa (sem mudo).
      </p>
    </section>
  );
}
