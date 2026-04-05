"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";

import {
  clampEchoLinkSetting,
  ECHO_LINK_SETTINGS_PLACEHOLDER,
  ECHO_LINK_STORAGE_KEY,
  hydrateEchoLinkSettingsFromElectron,
  loadEchoLinkSettingsFromLocalStorage,
  sanitizeMixerStripOrder,
  saveEchoLinkSettingsToStorage,
  type EchoLinkMixerStripId,
  type EchoLinkSettings,
  type EchoLinkSettingsKey,
  type EchoLinkSidebarSection,
} from "../lib/echoLinkSettings";
import { hydrateEchoLinkSettingsFromServer } from "../lib/echoLinkServerConfig";
import {
  mixCaptureAudioStreams,
  mixCaptureAudioStreamsTriple,
  passThroughCaptureWithGain,
} from "../lib/mixCaptureAudioStreams";
import { postEchoLinkRuntimeCapture } from "../lib/echoLinkRuntimeClient";
import {
  postEchoLinkChatSession,
  putEchoLinkChatSessionSnapshot,
} from "../lib/echoLinkChatSessionClient";
import {
  fetchEchoLinkChatSession,
  fetchEchoLinkChatSessions,
  type EchoLinkChatSessionDetail,
  type EchoLinkChatSessionListItem,
} from "../lib/echoLinkChatHistoryClient";
import {
  connectMonitorBranch,
  type AudioPipelineInject,
} from "../lib/audioPipeline";
import { getSpeechLanguageLabel } from "../lib/speechLanguages";
import { startServiceSttSession } from "../lib/serviceSttSession";
import {
  fetchElevenLabsVoiceDisplay,
  fetchElevenLabsVoices,
  fetchVoiceTranslationStatus,
  fetchTranslatedVoiceAudioWithText,
  playMp3OnDeviceSink,
  type ElevenLabsVoiceOption,
  type VoiceTranslationStatus,
} from "../lib/voiceTranslationClient";
import {
  EMPTY_ELEVEN_LABS_VOICE_DISPLAY,
  labelForElevenLabsVoiceId,
  resolveElevenLabsGenderSigla,
  type ElevenLabsVoiceDisplayBundle,
} from "../lib/elevenLabsVoiceDisplay";
import { formatMediaDeviceOptionLabel } from "../lib/mediaDeviceOptionLabel";
import { isSubstantivePhraseForJournal } from "../lib/substantivePhraseForJournal";
import { sttFinalTextPassesQualityGate } from "../lib/sttTranscriptQuality";
import { timingRangeProgress } from "../lib/timingRangeProgress";
import {
  applyMaxChannelWebAudioNodes,
  withIdealMultiChannelCapture,
} from "../lib/echoLinkMultiChannelAudio";
import { safeCloseAudioContext } from "../lib/safeCloseAudioContext";
import {
  subscribeEchoLinkChatAppend,
  type EchoLinkChatSpeaker,
} from "../lib/echoLinkChatBridge";
import {
  arrayBufferToBase64Mp3,
  createTranscriptJournalKey,
  decodeBase64ToArrayBuffer,
  deleteTranscriptJournalRow,
  hasJournalUserPhraseDuplicateForVoice,
  listJournalVoiceBuckets,
  listTranscriptJournalRowsForVoice,
  patchTranscriptJournalSelected,
  type JournalVoiceBucket,
  type TranscriptJournalRow,
  upsertTranscriptJournalRow,
} from "../lib/transcriptJournalDb";
import {
  echoLinkServiceOriginForDisplay,
  getEchoLinkMicWebSocketUrl,
  getEchoLinkSttWebSocketUrl,
  openEchoLinkServiceWebSocket,
} from "../lib/echoLinkLocalTransport";
import {
  AudioInLineInputDetailPanel,
  AudioInMediaInputDetailPanel,
  AudioInMicInputDetailPanel,
} from "./audioInChannelInputPanels";

const RX_DECAY = 0.91;
const RX_SPIKE = 0.42;
const MIC_TEST_MS = 4000;
const METER_LOG_ALIGN_MIN = 0.055;
const METER_LOG_IDLE_SCALE = 0.22;
const CHUNK_MS_MIN = 50;
const CHUNK_MS_MAX = 4000;
const CUT_MS_MAX = 15000;
const INPUT_SENS_MIN = 10;
const INPUT_SENS_MAX = 5000;
const LINE_CHANNEL_VU_SENSITIVITY_PERCENT = 100;
const IDLE_PREVIEW_MIX_HEADROOM = 0.92;

type AnalyserByteDomainBuffer = Parameters<
  AnalyserNode["getByteTimeDomainData"]
>[0];

function createByteDomainBuffer(size: number): AnalyserByteDomainBuffer {
  return new Uint8Array(new ArrayBuffer(size)) as AnalyserByteDomainBuffer;
}

const RMS_METER_NOISE_FLOOR = 0.018;

function mapRmsToMeterLevel(
  rms: number,
  inputSensitivityPercent: number
): number {
  const sensRatio = Math.max(0, inputSensitivityPercent / 100);
  const adaptiveFloor =
    RMS_METER_NOISE_FLOOR +
    Math.min(0.058, Math.max(0, sensRatio - 1) * 0.0026);
  const gated = Math.max(0, rms - adaptiveFloor);
  if (gated <= 0) {
    return 0;
  }
  const linearGain = 3.6 * Math.max(sensRatio, 0.01);
  const gain = Math.min(linearGain, 26);
  const x = Math.min(1, gated * gain);
  return 1 - Math.exp(-2.85 * x);
}

function smoothVuLevel(prev: number, instant: number): number {
  if (instant <= 0) {
    const d = prev * 0.72;
    return d < 0.0025 ? 0 : d;
  }
  return instant > prev
    ? prev * 0.78 + instant * 0.22
    : prev * 0.91 + instant * 0.09;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

function hintForServiceSttFailure(serverMessage: string): string {
  const m = serverMessage.toLowerCase();
  if (
    m.includes("transcribe:startstreamtranscription") ||
    m.includes("accessdenied") ||
    m.includes("(403")
  ) {
    return "IAM: conceda transcribe:StartStreamTranscription ao utilizador ou role usado pelo echoLinkService (para testes pode usar AmazonTranscribeFullAccess). Verifique AWS_PROFILE, AWS_REGION e credenciais.";
  }
  return "Por padrão o serviço usa Amazon Transcribe em streaming na AWS. Alternativa local: ECHO_LINK_STT_ENGINE=vosk e VOSK_MODEL_PATH no arranque do serviço.";
}

type SidebarSection = EchoLinkSidebarSection;

type AudioInChannelTab = "microphone" | "systemAudio" | "media";

type MixerSideEditorTab = AudioInChannelTab | "output";

type AudioInLayoutMode = "mixer" | "detail";

type AudioInDetailScope = "both" | "microphone" | "systemAudio" | "media";

type CaptureGainControlsRef =
  | {
      mode: "single";
      setPrimaryLinear: (n: number) => void;
    }
  | {
      mode: "dual";
      setPrimaryLinear: (n: number) => void;
      setSecondaryLinear: (n: number) => void;
    }
  | {
      mode: "triple";
      setPrimaryLinear: (n: number) => void;
      setSecondaryLinear: (n: number) => void;
      setTertiaryLinear: (n: number) => void;
    };

const MIX_FADER_MAX = 150;

function formatMixFaderDbLabel(percent: number): string {
  if (percent <= 0) return "−∞";
  const db = 20 * Math.log10(percent / 100);
  if (db > 9) return "+10";
  if (db >= -0.35 && db <= 0.35) return "0";
  const rounded = Math.round(db);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

const MIXER_TOOLBAR_ICON_CLASS =
  "pointer-events-none mx-auto block h-8 w-8 shrink-0 sm:h-10 sm:w-10";

function IconMixerPower({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}

function IconMixerSettings({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconMixerVolumeOn({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function IconMixerVolumeMuted({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </svg>
  );
}

function MixerFaderDbScale({
  level,
  className = "",
}: {
  level: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, level * 100));
  const labelClass =
    "relative z-10 text-right font-mono text-[10px] font-medium leading-none text-zinc-200 drop-shadow-[0_1px_2px_rgba(0,0,0,1)] sm:text-[11px]";
  return (
    <div
      className={`relative h-full min-h-0 overflow-hidden bg-black ${className}`}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Nível de áudio na escala em dB"
    >
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 opacity-[0.92] transition-[height] duration-75 ease-out bg-linear-to-t from-emerald-600/80 via-amber-400/65 to-red-500/55"
        style={{ height: `${pct}%` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-1 opacity-35"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(0,0,0,0.45) 5px, rgba(0,0,0,0.45) 6px)",
        }}
        aria-hidden
      />
      <div className="relative z-2 flex h-full flex-col justify-between">
        <span className={labelClass}>+10</span>
        <span className={labelClass}>0</span>
        <span className={labelClass}>−10</span>
        <span className={labelClass}>−20</span>
        <span className={labelClass}>−30</span>
        <span className={labelClass}>−40</span>
        <span className={labelClass}>−60</span>
        <span
          className={`${labelClass} text-[9px] text-zinc-400 sm:text-[10px]`}
        >
          −∞
        </span>
      </div>
    </div>
  );
}

function mixerChannelStripBorderColorClass(
  role: "input" | "output",
  activateOn: boolean,
  muted: boolean,
  faderDisabled?: boolean
): string {
  const pathOff = !activateOn || Boolean(faderDisabled);
  if (pathOff) {
    return "border-amber-400";
  }
  if (muted) {
    return "border-red-500";
  }
  if (role === "output") {
    return "border-blue-500";
  }
  return "border-emerald-500";
}

function mixerChannelStripBadgeToneClassName(
  role: "input" | "output",
  activateOn: boolean,
  muted: boolean,
  faderDisabled?: boolean
): string {
  const pathOff = !activateOn || Boolean(faderDisabled);
  if (pathOff) {
    return "bg-amber-400 text-black";
  }
  if (muted) {
    return "bg-red-600 text-white";
  }
  if (role === "output") {
    return "bg-sky-500 text-black";
  }
  return "bg-emerald-500 text-black";
}

const MIXER_STRIP_DND_TYPE = "application/x-echolink-mixer-strip";

function moveMixerStripInOrder(
  order: EchoLinkMixerStripId[],
  fromId: EchoLinkMixerStripId,
  toId: EchoLinkMixerStripId
): EchoLinkMixerStripId[] {
  if (fromId === toId) {
    return order;
  }
  const next = order.filter((x) => x !== fromId);
  const i = next.indexOf(toId);
  if (i < 0) {
    return order;
  }
  next.splice(i, 0, fromId);
  return next;
}

function MixerStripTopDragHandle({
  stripId,
  draggingStripId,
  onDragStart,
  onDragEnd,
}: {
  stripId: EchoLinkMixerStripId;
  draggingStripId: EchoLinkMixerStripId | null;
  onDragStart: (id: EchoLinkMixerStripId) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className="mb-1.5 flex shrink-0 cursor-grab justify-center px-1 pt-0.5 active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIXER_STRIP_DND_TYPE, stripId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(stripId);
      }}
      onDragEnd={onDragEnd}
      title="Arrastar para reordenar as faixas"
      aria-label="Arrastar para reordenar as faixas do mixer"
    >
      <div
        className={`h-0.5 w-10 shrink-0 rounded-full sm:w-12 ${
          draggingStripId === stripId ? "bg-zinc-400" : "bg-zinc-500/75"
        }`}
      />
    </div>
  );
}

type MixerStripDnDProps = {
  mixerStripId: EchoLinkMixerStripId;
  stripStackIndex: number;
  draggingMixerStripId: EchoLinkMixerStripId | null;
  onMixerStripDragStart: (id: EchoLinkMixerStripId) => void;
  onMixerStripDragEnd: () => void;
  onMixerStripDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onMixerStripDrop: (
    e: DragEvent<HTMLDivElement>,
    targetId: EchoLinkMixerStripId
  ) => void;
};

type MixerConsoleInputChannelProps = {
  channelId: 1 | 2 | 3;
  activateOn: boolean;
  onActivateToggle: () => void;
  onEdit: () => void;
  muted: boolean;
  onMuteToggle: () => void;
  deviceLabel: string;
  vuLevel: number;
  faderValue: number;
  onFaderChange: (v: number) => void;
  faderDisabled: boolean;
  busy: boolean;
} & MixerStripDnDProps;

function MixerConsoleInputChannel({
  channelId,
  activateOn,
  onActivateToggle,
  onEdit,
  muted,
  onMuteToggle,
  deviceLabel,
  vuLevel,
  faderValue,
  onFaderChange,
  faderDisabled,
  busy,
  mixerStripId,
  stripStackIndex,
  draggingMixerStripId,
  onMixerStripDragStart,
  onMixerStripDragEnd,
  onMixerStripDragOver,
  onMixerStripDrop,
}: MixerConsoleInputChannelProps) {
  const mixerIconHit =
    "inline-flex w-full min-h-11 items-center justify-center rounded-md border-0 bg-transparent py-1.5 outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-12 sm:py-2";
  const vuLevelShown =
    activateOn && !muted && !faderDisabled ? vuLevel : 0;
  const stripDim =
    !activateOn ? "opacity-40" : muted ? "opacity-55" : "";
  const faderZoneMutedVisual =
    faderDisabled && activateOn ? "opacity-[0.55]" : "";
  const chRole =
    channelId === 1
      ? "microfone"
      : channelId === 2
        ? "entrada teams"
        : "entrada mídia";
  const faderDomId = `echo-mixer-fader-ch${channelId}`;
  const faderAria =
    channelId === 1
      ? "Ganho do microfone na mistura"
      : channelId === 2
        ? "Ganho da entrada Teams na mistura"
        : "Ganho da entrada mídia na mistura";
  const mixerFaderTitle =
    channelId === 1 ? "Microfone" : channelId === 2 ? "Teams" : "MÍDIA";
  return (
    <div
      className={`relative isolate box-border flex min-h-0 w-[11.5rem] shrink-0 flex-col overflow-hidden border-l-2 border-solid bg-linear-to-b from-zinc-800/30 via-zinc-950 to-[#050506] px-2.5 pb-0 pt-2 sm:w-[13.25rem] sm:px-3 ${mixerChannelStripBorderColorClass("input", activateOn, muted, faderDisabled)} ${draggingMixerStripId === mixerStripId ? "opacity-50" : ""}`}
      style={{ zIndex: stripStackIndex + 1 }}
      onDragOver={onMixerStripDragOver}
      onDrop={(e) => onMixerStripDrop(e, mixerStripId)}
    >
      <MixerStripTopDragHandle
        stripId={mixerStripId}
        draggingStripId={draggingMixerStripId}
        onDragStart={onMixerStripDragStart}
        onDragEnd={onMixerStripDragEnd}
      />
      <p className="mb-1.5 shrink-0 border-0 bg-transparent px-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 shadow-none ring-0 outline-none sm:text-[11px] sm:tracking-[0.22em]">
        ENTRADA
      </p>
      <div className="mb-1.5 flex min-w-0 shrink-0 flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onActivateToggle}
          title={activateOn ? "Desativar canal" : "Ativar canal"}
          aria-label={
            activateOn
              ? `Desativar canal de ${chRole}`
              : `Ativar canal de ${chRole}`
          }
          className={`${mixerIconHit} ${
            activateOn
              ? "text-emerald-400 drop-shadow-[0_0_14px_rgba(52,211,153,0.45)]"
              : "text-zinc-100"
          }`}
        >
          <IconMixerPower className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onEdit}
          title="Editar dispositivo e tempos"
          aria-label={`Editar definições do canal de ${chRole}`}
          className={`${mixerIconHit} ${
            activateOn ? "text-sky-400" : "text-zinc-600"
          }`}
        >
          <IconMixerSettings className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onMuteToggle}
          title={
            muted && activateOn ? "Restaurar som do canal" : "Silenciar canal"
          }
          aria-label={
            muted && activateOn
              ? `Restaurar som do canal de ${chRole}`
              : `Silenciar canal de ${chRole}`
          }
          className={`${mixerIconHit} ${
            muted && activateOn
              ? "text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.55)]"
              : "text-zinc-500"
          }`}
        >
          {muted && activateOn ? (
            <IconMixerVolumeMuted className={MIXER_TOOLBAR_ICON_CLASS} />
          ) : (
            <IconMixerVolumeOn className={MIXER_TOOLBAR_ICON_CLASS} />
          )}
        </button>
      </div>
      <p className="mb-1 line-clamp-2 min-h-8 shrink-0 text-center text-[8px] leading-snug text-zinc-400 sm:text-[9px]">
        {deviceLabel}
      </p>
      <div
        className={`flex min-h-0 flex-1 flex-col bg-black pb-2 ${stripDim}`}
      >
        <div
          className={`flex min-h-[11rem] min-w-0 flex-1 items-stretch gap-1.5 sm:min-h-[12rem] ${faderZoneMutedVisual}`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
            <div className="echo-mixer-fader-slot relative isolate min-h-0 min-w-[5.25rem] flex-1 overflow-hidden bg-black sm:min-w-[6rem]">
              <div
                className="pointer-events-none absolute inset-0 z-0 shadow-[inset_0_0_20px_rgba(0,0,0,1)]"
                aria-hidden
              />
              <input
                id={faderDomId}
                name={`echoMixerFaderCh${channelId}`}
                type="range"
                min={0}
                max={MIX_FADER_MAX}
                step={1}
                disabled={busy}
                value={faderValue}
                onChange={(e) =>
                  onFaderChange(Number.parseInt(e.target.value, 10))
                }
                className="echo-mixer-fader-input echo-console-fader"
                aria-label={faderAria}
              />
            </div>
          </div>
          <div className="echo-mixer-fader-meter-column flex h-full min-h-0 shrink-0 flex-col">
            <MixerFaderDbScale
              level={vuLevelShown}
              className="min-h-0 w-9 flex-1 sm:w-10"
            />
          </div>
        </div>
        <div className="pt-1 text-center font-mono text-[8px] tabular-nums text-zinc-500 sm:text-[9px]">
          {formatMixFaderDbLabel(faderValue)} · {faderValue}%
        </div>
        <div className="border-t border-zinc-800/50 pt-1.5 text-center font-mono text-xs font-semibold tabular-nums text-zinc-100">
          {channelId}
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 pb-2 pt-2">
        <p
          className={`shrink-0 rounded-md px-2 py-1 text-center font-mono text-[12px] font-bold uppercase tracking-[0.2em] sm:text-[13px] sm:tracking-[0.22em] ${mixerChannelStripBadgeToneClassName("input", activateOn, muted, faderDisabled)}`}
        >
          {mixerFaderTitle}
        </p>
      </div>
    </div>
  );
}

type MixerConsoleOutputChannelProps = {
  activateOn: boolean;
  onActivateToggle: () => void;
  onEdit: () => void;
  muted: boolean;
  onMuteToggle: () => void;
  deviceLabel: string;
  vuLevel: number;
  faderValue: number;
  onFaderChange: (v: number) => void;
  faderDisabled: boolean;
  busy: boolean;
  activateDisabled: boolean;
} & MixerStripDnDProps;

function MixerConsoleOutputChannel({
  activateOn,
  onActivateToggle,
  onEdit,
  muted,
  onMuteToggle,
  deviceLabel,
  vuLevel,
  faderValue,
  onFaderChange,
  faderDisabled,
  busy,
  activateDisabled,
  mixerStripId,
  stripStackIndex,
  draggingMixerStripId,
  onMixerStripDragStart,
  onMixerStripDragEnd,
  onMixerStripDragOver,
  onMixerStripDrop,
}: MixerConsoleOutputChannelProps) {
  const mixerIconHit =
    "inline-flex w-full min-h-11 items-center justify-center rounded-md border-0 bg-transparent py-1.5 outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-12 sm:py-2";
  const vuLevelShown =
    activateOn && !muted && !faderDisabled ? vuLevel : 0;
  const stripDim =
    !activateOn ? "opacity-40" : muted ? "opacity-55" : "";
  const faderZoneMutedVisual =
    faderDisabled && activateOn ? "opacity-[0.55]" : "";
  const faderDomId = "echo-mixer-fader-output";
  return (
    <div
      className={`relative isolate box-border flex min-h-0 w-[11.5rem] shrink-0 flex-col overflow-hidden border-l-2 border-solid bg-linear-to-b from-zinc-800/30 via-zinc-950 to-[#050506] px-2.5 pb-0 pt-2 sm:w-[13.25rem] sm:px-3 ${mixerChannelStripBorderColorClass("output", activateOn, muted, faderDisabled)} ${draggingMixerStripId === mixerStripId ? "opacity-50" : ""}`}
      style={{ zIndex: stripStackIndex + 1 }}
      onDragOver={onMixerStripDragOver}
      onDrop={(e) => onMixerStripDrop(e, mixerStripId)}
    >
      <MixerStripTopDragHandle
        stripId={mixerStripId}
        draggingStripId={draggingMixerStripId}
        onDragStart={onMixerStripDragStart}
        onDragEnd={onMixerStripDragEnd}
      />
      <p className="mb-1.5 shrink-0 border-0 bg-transparent px-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 shadow-none ring-0 outline-none sm:text-[11px] sm:tracking-[0.22em]">
        SAÍDA
      </p>
      <div className="mb-1.5 flex min-w-0 shrink-0 flex-col gap-2">
        <button
          type="button"
          disabled={busy || activateDisabled}
          onClick={onActivateToggle}
          title={
            activateOn
              ? "Desativar monitor entrada → saída"
              : "Ativar monitor entrada → saída"
          }
          aria-label={
            activateOn
              ? "Desativar monitor de saída (entrada para o dispositivo de áudio)"
              : "Ativar monitor de saída (entrada para o dispositivo de áudio)"
          }
          className={`${mixerIconHit} ${
            activateOn
              ? "text-sky-400 drop-shadow-[0_0_14px_rgba(56,189,248,0.45)]"
              : "text-zinc-100"
          }`}
        >
          <IconMixerPower className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onEdit}
          title="Editar saída de áudio"
          aria-label="Editar definições de saída de áudio (dispositivo, monitor e tradução)"
          className={`${mixerIconHit} ${
            activateOn ? "text-sky-400" : "text-zinc-600"
          }`}
        >
          <IconMixerSettings className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onMuteToggle}
          title={
            muted && activateOn
              ? "Restaurar som na saída"
              : "Silenciar saída do monitor"
          }
          aria-label={
            muted && activateOn
              ? "Restaurar som do monitor de saída"
              : "Silenciar monitor de saída"
          }
          className={`${mixerIconHit} ${
            muted && activateOn
              ? "text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.55)]"
              : "text-zinc-500"
          }`}
        >
          {muted && activateOn ? (
            <IconMixerVolumeMuted className={MIXER_TOOLBAR_ICON_CLASS} />
          ) : (
            <IconMixerVolumeOn className={MIXER_TOOLBAR_ICON_CLASS} />
          )}
        </button>
      </div>
      <p className="mb-1 line-clamp-2 min-h-8 shrink-0 text-center text-[8px] leading-snug text-zinc-400 sm:text-[9px]">
        {deviceLabel}
      </p>
      <div
        className={`flex min-h-0 flex-1 flex-col bg-black pb-2 ${stripDim}`}
      >
        <div
          className={`flex min-h-[11rem] min-w-0 flex-1 items-stretch gap-1.5 sm:min-h-[12rem] ${faderZoneMutedVisual}`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
            <div className="echo-mixer-fader-slot relative isolate min-h-0 min-w-[5.25rem] flex-1 overflow-hidden bg-black sm:min-w-[6rem]">
              <div
                className="pointer-events-none absolute inset-0 z-0 shadow-[inset_0_0_20px_rgba(0,0,0,1)]"
                aria-hidden
              />
              <input
                id={faderDomId}
                name="echoMixerFaderOutput"
                type="range"
                min={0}
                max={MIX_FADER_MAX}
                step={1}
                disabled={busy}
                value={faderValue}
                onChange={(e) =>
                  onFaderChange(Number.parseInt(e.target.value, 10))
                }
                className="echo-mixer-fader-input echo-console-fader"
                aria-label="Ganho da saída (monitor)"
              />
            </div>
          </div>
          <div className="echo-mixer-fader-meter-column flex h-full min-h-0 shrink-0 flex-col">
            <MixerFaderDbScale
              level={vuLevelShown}
              className="min-h-0 w-9 flex-1 sm:w-10"
            />
          </div>
        </div>
        <div className="pt-1 text-center font-mono text-[8px] tabular-nums text-zinc-500 sm:text-[9px]">
          {formatMixFaderDbLabel(faderValue)} · {faderValue}%
        </div>
        <div className="border-t border-zinc-800/50 pt-1.5 text-center font-mono text-xs font-semibold tabular-nums text-zinc-100">
          4
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 pb-2 pt-2">
        <p
          className={`shrink-0 rounded-md px-2 py-1 text-center font-mono text-[12px] font-bold uppercase tracking-[0.2em] sm:text-[13px] sm:tracking-[0.22em] ${mixerChannelStripBadgeToneClassName("output", activateOn, muted, faderDisabled)}`}
        >
          Master
        </p>
      </div>
    </div>
  );
}

type TranscriptLineEntry = {
  id: number;
  journalKey: string;
  chatSpeaker: EchoLinkChatSpeaker;
  pt: string;
  en?: string;
  translationAudio?: ArrayBuffer;
  translationOrigin?: "cache" | "network";
  journalDate?: string;
  voiceId?: string;
  voiceLabel?: string;
  audioBase64?: string;
  replayCount?: number;
};

function serializeChatLinesForService(
  lines: TranscriptLineEntry[]
): Record<string, unknown>[] {
  return lines.map((line) => {
    const o: Record<string, unknown> = {
      id: line.id,
      journalKey: line.journalKey,
      chatSpeaker: line.chatSpeaker,
      pt: line.pt,
    };
    if (line.en) {
      o.en = line.en;
    }
    if (line.journalDate) {
      o.journalDate = line.journalDate;
    }
    if (line.voiceId) {
      o.voiceId = line.voiceId;
    }
    if (line.voiceLabel) {
      o.voiceLabel = line.voiceLabel;
    }
    if (line.translationOrigin) {
      o.translationOrigin = line.translationOrigin;
    }
    if (typeof line.replayCount === "number") {
      o.replayCount = line.replayCount;
    }
    if (line.audioBase64) {
      o.audioBase64 = line.audioBase64;
    }
    return o;
  });
}

function createTestBeepWavUrl(
  frequencyHz: number,
  durationSec: number,
  sampleRate: number
): string {
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  w(8, "WAVE");
  w(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  const amp = 7200;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * amp;
    v.setInt16(o, s, true);
    o += 2;
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

async function playTestBeep(outputDeviceId: string): Promise<void> {
  const sampleRate = 44100;
  const durationSec = 0.35;
  const url = createTestBeepWavUrl(440, durationSec, sampleRate);
  try {
    const audio = new Audio(url);
    audio.volume = 0.45;
    const media = audio as HTMLAudioElement & {
      setSinkId?: (sinkId: string) => Promise<void>;
    };
    if (outputDeviceId.trim() && typeof media.setSinkId === "function") {
      await media.setSinkId(outputDeviceId);
    }
    await audio.play();
    await new Promise((r) => setTimeout(r, durationSec * 1000 + 120));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type MicCaptureProps = {
  audioPipelineInject?: AudioPipelineInject;
};

export function MicCapture({ audioPipelineInject }: MicCaptureProps = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mixDisposeRef = useRef<(() => void) | null>(null);
  const captureGainControlsRef = useRef<CaptureGainControlsRef | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pipelineMonitorSourceRef = useRef<MediaStreamAudioSourceNode | null>(
    null
  );
  const pipelineBranchCleanupRef = useRef<(() => void) | null>(null);
  const pipelineGainNodeRef = useRef<GainNode | null>(null);
  const pipelineOutputAnalyserRef = useRef<AnalyserNode | null>(null);
  const pipelineOutBufRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const pipelineOutRafRef = useRef<number>(0);
  const pipelineOutSmoothRef = useRef(0);
  const pipelineInjectRef = useRef<AudioPipelineInject | undefined>(undefined);
  const idlePreviewMonitorGainRef = useRef<GainNode | null>(null);
  const idlePreviewPrimGainRef = useRef<GainNode | null>(null);
  const idlePreviewSecGainRef = useRef<GainNode | null>(null);
  const idlePreviewTertGainRef = useRef<GainNode | null>(null);
  const idlePreviewMixStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mixPrimaryAnalyserRef = useRef<AnalyserNode | null>(null);
  const mixSecondaryAnalyserRef = useRef<AnalyserNode | null>(null);
  const mixTertiaryAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const timeDomainRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const timeDomainSecondaryRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const timeDomainTertiaryRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const rxPulseRef = useRef(0);
  const micVuSmoothRef = useRef(0);
  const lineVuSmoothRef = useRef(0);
  const mediaVuSmoothRef = useRef(0);
  const serviceSttCleanupRef = useRef<(() => void) | null>(null);
  const phraseSilenceCutMsRef = useRef(
    ECHO_LINK_SETTINGS_PLACEHOLDER.phraseSilenceCutMs
  );
  const inputSensitivityRef = useRef(
    ECHO_LINK_SETTINGS_PLACEHOLDER.inputSensitivity
  );
  const speechReceiveLangRef = useRef(
    ECHO_LINK_SETTINGS_PLACEHOLDER.speechReceiveLanguage
  );
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const handleSttFinalRef = useRef<(text: string) => void>(() => {});
  const selectedOutputIdRef = useRef("");
  const voicePlayChainRef = useRef(Promise.resolve());

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceBytes, setServiceBytes] = useState(0);
  const [serviceChunks, setServiceChunks] = useState(0);
  const [connected, setConnected] = useState(false);
  const [micVu, setMicVu] = useState(0);
  const [lineVu, setLineVu] = useState(0);
  const [mediaVu, setMediaVu] = useState(0);
  const [idleInputGraphSeq, setIdleInputGraphSeq] = useState(0);
  const [captureStarting, setCaptureStarting] = useState(false);
  const [rxLevel, setRxLevel] = useState(0);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>(
    () => ECHO_LINK_SETTINGS_PLACEHOLDER.selectedInputDeviceId
  );
  const [selectedSecondaryInputId, setSelectedSecondaryInputId] =
    useState<string>(
      () => ECHO_LINK_SETTINGS_PLACEHOLDER.selectedSecondaryInputDeviceId
    );
  const [selectedTertiaryInputId, setSelectedTertiaryInputId] =
    useState<string>(
      () => ECHO_LINK_SETTINGS_PLACEHOLDER.selectedTertiaryInputDeviceId
    );
  const [selectedOutputId, setSelectedOutputId] = useState<string>(
    () => ECHO_LINK_SETTINGS_PLACEHOLDER.selectedOutputDeviceId
  );
  const [micTesting, setMicTesting] = useState(false);
  const [outputTesting, setOutputTesting] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLineEntry[]>(
    []
  );
  const transcriptLinesRef = useRef<TranscriptLineEntry[]>([]);
  const transcriptLineIdRef = useRef(0);
  const captureChatSessionIdRef = useRef<string | null>(null);
  const [captureChatSessionId, setCaptureChatSessionId] = useState<
    string | null
  >(null);
  const [chatPanelExpanded, setChatPanelExpanded] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [serviceSttReady, setServiceSttReady] = useState(false);
  const [serviceSttFailed, setServiceSttFailed] = useState(false);
  const [serviceSttBootstrapError, setServiceSttBootstrapError] = useState<
    string | null
  >(null);
  const [settings, setSettings] = useState<EchoLinkSettings>(() => ({
    ...ECHO_LINK_SETTINGS_PLACEHOLDER,
  }));
  const [sidebarSection, setSidebarSection] = useState<SidebarSection>(
    "audioIn"
  );
  const [audioInChannelTab, setAudioInChannelTab] =
    useState<AudioInChannelTab>(() =>
      typeof window === "undefined"
        ? ECHO_LINK_SETTINGS_PLACEHOLDER.audioInChannelTab
        : loadEchoLinkSettingsFromLocalStorage().audioInChannelTab
    );
  const [audioInDetailScope, setAudioInDetailScope] =
    useState<AudioInDetailScope>(() =>
      typeof window === "undefined"
        ? ECHO_LINK_SETTINGS_PLACEHOLDER.audioInDetailScope
        : loadEchoLinkSettingsFromLocalStorage().audioInDetailScope
    );
  const [audioInLayoutMode, setAudioInLayoutMode] =
    useState<AudioInLayoutMode>(() =>
      typeof window === "undefined"
        ? ECHO_LINK_SETTINGS_PLACEHOLDER.audioInLayoutMode
        : loadEchoLinkSettingsFromLocalStorage().audioInLayoutMode
    );
  const audioInActivePanel: AudioInChannelTab =
    audioInDetailScope === "both"
      ? audioInChannelTab
      : audioInDetailScope;
  const [mixerActivate1, setMixerActivate1] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel1Active
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel1Active
  );
  const [mixerActivate2, setMixerActivate2] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel2Active
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel2Active
  );
  const [mixerActivate3, setMixerActivate3] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel3Active
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel3Active
  );
  const [mixerMute1, setMixerMute1] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel1Muted
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel1Muted
  );
  const [mixerMute2, setMixerMute2] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel2Muted
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel2Muted
  );
  const [mixerMute3, setMixerMute3] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerChannel3Muted
      : loadEchoLinkSettingsFromLocalStorage().mixerChannel3Muted
  );
  const [mixerOutputMute, setMixerOutputMute] = useState(() =>
    typeof window === "undefined"
      ? ECHO_LINK_SETTINGS_PLACEHOLDER.mixerOutputMuted
      : loadEchoLinkSettingsFromLocalStorage().mixerOutputMuted
  );
  const [draggingMixerStripId, setDraggingMixerStripId] =
    useState<EchoLinkMixerStripId | null>(null);
  const [mixerSideEditor, setMixerSideEditor] =
    useState<MixerSideEditorTab | null>(null);
  const [vocabularyRows, setVocabularyRows] = useState<TranscriptJournalRow[]>(
    []
  );
  const [vocabularyVoiceBuckets, setVocabularyVoiceBuckets] = useState<
    JournalVoiceBucket[]
  >([]);
  const [vocabularySelectedVoiceId, setVocabularySelectedVoiceId] =
    useState("");
  const [vocabularyLoading, setVocabularyLoading] = useState(false);
  const [vocabularyRegistryLoading, setVocabularyRegistryLoading] =
    useState(false);
  const [chatHistoryItems, setChatHistoryItems] = useState<
    EchoLinkChatSessionListItem[]
  >([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(false);
  const [chatHistorySelectedId, setChatHistorySelectedId] = useState<
    string | null
  >(null);
  const [chatHistoryDetail, setChatHistoryDetail] =
    useState<EchoLinkChatSessionDetail | null>(null);
  const [chatHistoryDetailLoading, setChatHistoryDetailLoading] =
    useState(false);
  const [pipelineMonitorEnabled, setPipelineMonitorEnabled] = useState(
    () => ECHO_LINK_SETTINGS_PLACEHOLDER.pipelineMonitorEnabled
  );
  const [pipelineMonitorGain, setPipelineMonitorGain] = useState(() => {
    const p = ECHO_LINK_SETTINGS_PLACEHOLDER.pipelineMonitorGainPercent;
    return Math.min(1, Math.max(0.01, p / 100));
  });
  const pipelineMonitorGainRef = useRef(
    Math.min(
      1,
      Math.max(
        0.01,
        ECHO_LINK_SETTINGS_PLACEHOLDER.pipelineMonitorGainPercent / 100
      )
    )
  );
  const [pipelineOutVu, setPipelineOutVu] = useState(0);
  const [voiceTranslationEnabled, setVoiceTranslationEnabled] = useState(
    () => ECHO_LINK_SETTINGS_PLACEHOLDER.voiceTranslationEnabled
  );
  const voiceTranslationEnabledRef = useRef(voiceTranslationEnabled);
  voiceTranslationEnabledRef.current = voiceTranslationEnabled;
  const [voiceTranslationBackendStatus, setVoiceTranslationBackendStatus] =
    useState<VoiceTranslationStatus | null>(null);
  const [elevenLabsVoicesFromApi, setElevenLabsVoicesFromApi] = useState<
    ElevenLabsVoiceOption[] | null
  >(null);
  const [elevenLabsVoicesLoading, setElevenLabsVoicesLoading] = useState(false);
  const [elevenLabsVoiceDisplayBundle, setElevenLabsVoiceDisplayBundle] =
    useState<ElevenLabsVoiceDisplayBundle>(EMPTY_ELEVEN_LABS_VOICE_DISPLAY);
  const voiceTranslationBackendStatusRef = useRef<VoiceTranslationStatus | null>(
    null
  );
  const selectedElevenLabsVoiceIdRef = useRef("");
  const elevenLabsVoiceLabelsRef = useRef<Record<string, string>>({});
  const voiceIdForTranslationRef = useRef("");
  const [pipelineBranchLive, setPipelineBranchLive] = useState(false);
  const [meterSampleRate, setMeterSampleRate] = useState(0);
  const [serviceChunksBaseline, setServiceChunksBaseline] = useState(0);
  const [pipelineUtteranceVersion, setPipelineUtteranceVersion] = useState(0);
  const [pipelineVisibleDoneCount, setPipelineVisibleDoneCount] = useState(0);
  const serviceChunksRef = useRef(0);
  const bumpPipelineUtteranceRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    pipelineInjectRef.current = audioPipelineInject;
  }, [audioPipelineInject]);

  useEffect(() => {
    let cancelled = false;
    void fetchElevenLabsVoiceDisplay().then((b) => {
      if (!cancelled) {
        setElevenLabsVoiceDisplayBundle(b);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sidebarSection !== "chats") {
      return;
    }
    let cancelled = false;
    setChatHistoryLoading(true);
    void fetchEchoLinkChatSessions()
      .then((list) => {
        if (!cancelled) {
          setChatHistoryItems(list);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChatHistoryLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sidebarSection]);

  useEffect(() => {
    if (sidebarSection !== "chats" || !chatHistorySelectedId) {
      setChatHistoryDetail(null);
      setChatHistoryDetailLoading(false);
      return;
    }
    let cancelled = false;
    setChatHistoryDetailLoading(true);
    void fetchEchoLinkChatSession(chatHistorySelectedId).then((d) => {
      if (!cancelled) {
        setChatHistoryDetail(d);
        setChatHistoryDetailLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sidebarSection, chatHistorySelectedId]);

  useEffect(() => {
    elevenLabsVoiceLabelsRef.current = elevenLabsVoiceDisplayBundle.voiceLabels;
  }, [elevenLabsVoiceDisplayBundle]);

  useEffect(() => {
    pipelineMonitorGainRef.current = pipelineMonitorGain;
  }, [pipelineMonitorGain]);

  const applyUiFromEchoLinkSettings = useCallback((s: EchoLinkSettings) => {
    setSelectedInputId(s.selectedInputDeviceId);
    setSelectedSecondaryInputId(s.selectedSecondaryInputDeviceId);
    setSelectedTertiaryInputId(s.selectedTertiaryInputDeviceId);
    setSelectedOutputId(s.selectedOutputDeviceId);
    setVoiceTranslationEnabled(s.voiceTranslationEnabled);
    setPipelineMonitorEnabled(s.pipelineMonitorEnabled);
    const g = Math.min(
      1,
      Math.max(0.01, s.pipelineMonitorGainPercent / 100)
    );
    setPipelineMonitorGain(g);
    pipelineMonitorGainRef.current = g;
    setAudioInLayoutMode(s.audioInLayoutMode);
    setAudioInDetailScope(s.audioInDetailScope);
    setAudioInChannelTab(s.audioInChannelTab);
    setMixerActivate1(s.mixerChannel1Active);
    setMixerActivate2(s.mixerChannel2Active);
    setMixerActivate3(s.mixerChannel3Active);
    setMixerMute1(s.mixerChannel1Muted);
    setMixerMute2(s.mixerChannel2Muted);
    setMixerMute3(s.mixerChannel3Muted);
    setMixerOutputMute(s.mixerOutputMuted);
  }, []);

  useEffect(() => {
    void (async () => {
      const [fromElectron, fromServer] = await Promise.all([
        hydrateEchoLinkSettingsFromElectron(),
        hydrateEchoLinkSettingsFromServer(),
      ]);
      let next: EchoLinkSettings;
      if (fromServer) {
        next = fromServer;
      } else if (fromElectron) {
        next = fromElectron;
      } else {
        next = loadEchoLinkSettingsFromLocalStorage();
      }
      setSettings(next);
      applyUiFromEchoLinkSettings(next);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ECHO_LINK_STORAGE_KEY, JSON.stringify(next));
      }
    })();
  }, [applyUiFromEchoLinkSettings]);

  useEffect(() => {
    phraseSilenceCutMsRef.current = settings.phraseSilenceCutMs;
  }, [settings.phraseSilenceCutMs]);

  useEffect(() => {
    inputSensitivityRef.current = settings.inputSensitivity;
  }, [settings.inputSensitivity]);

  useEffect(() => {
    speechReceiveLangRef.current = settings.speechReceiveLanguage;
  }, [settings.speechReceiveLanguage]);

  const setSettingsField = useCallback(
    (key: EchoLinkSettingsKey, raw: string) => {
      const n = clampEchoLinkSetting(
        key,
        Number.parseInt(raw, 10) || 0
      );
      setSettings((prev) => {
        const next = { ...prev, [key]: n };
        saveEchoLinkSettingsToStorage({ [key]: n });
        return next;
      });
    },
    []
  );

  const setMixerChannelMixGainPercent = useCallback(
    (ch: 1 | 2 | 3 | 4, v: number) => {
      if (ch === 1) {
        setSettings((prev) => ({ ...prev, primaryChannelMixGainPercent: v }));
        saveEchoLinkSettingsToStorage({ primaryChannelMixGainPercent: v });
        return;
      }
      if (ch === 2) {
        setSettings((prev) => ({
          ...prev,
          secondaryChannelMixGainPercent: v,
        }));
        saveEchoLinkSettingsToStorage({ secondaryChannelMixGainPercent: v });
        return;
      }
      if (ch === 3) {
        setSettings((prev) => ({
          ...prev,
          tertiaryChannelMixGainPercent: v,
        }));
        saveEchoLinkSettingsToStorage({ tertiaryChannelMixGainPercent: v });
        return;
      }
      setSettings((prev) => ({
        ...prev,
        outputChannelMixGainPercent: v,
      }));
      saveEchoLinkSettingsToStorage({ outputChannelMixGainPercent: v });
    },
    []
  );

  const handleMixerStripDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    []
  );

  const handleMixerStripDragStart = useCallback((id: EchoLinkMixerStripId) => {
    setDraggingMixerStripId(id);
  }, []);

  const handleMixerStripDragEnd = useCallback(() => {
    setDraggingMixerStripId(null);
  }, []);

  const handleMixerStripDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: EchoLinkMixerStripId) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(MIXER_STRIP_DND_TYPE);
      if (
        raw !== "ch1" &&
        raw !== "ch2" &&
        raw !== "ch3" &&
        raw !== "output"
      ) {
        setDraggingMixerStripId(null);
        return;
      }
      const fromId = raw as EchoLinkMixerStripId;
      setDraggingMixerStripId(null);
      setSettings((prev) => {
        const base = sanitizeMixerStripOrder(prev.mixerStripOrder);
        const nextOrder = moveMixerStripInOrder(base, fromId, targetId);
        const unchanged =
          nextOrder.length === base.length &&
          nextOrder.every((x, i) => x === base[i]);
        if (unchanged) {
          return prev;
        }
        saveEchoLinkSettingsToStorage({ mixerStripOrder: nextOrder });
        return { ...prev, mixerStripOrder: nextOrder };
      });
    },
    []
  );

  useEffect(() => {
    transcriptLinesRef.current = transcriptLines;
  }, [transcriptLines]);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcriptLines, interimTranscript]);

  useEffect(() => {
    if (!running || !captureChatSessionId) {
      return;
    }
    const sid = captureChatSessionId;
    const handle = window.setTimeout(() => {
      void putEchoLinkChatSessionSnapshot(sid, {
        messages: serializeChatLinesForService(transcriptLinesRef.current),
        interimPt: interimTranscript.trim() || null,
        ended: false,
      });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [transcriptLines, interimTranscript, running, captureChatSessionId]);

  useEffect(() => {
    serviceChunksRef.current = serviceChunks;
  }, [serviceChunks]);

  const bumpPipelineUtterance = useCallback(() => {
    setServiceChunksBaseline(serviceChunksRef.current);
    setPipelineUtteranceVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    bumpPipelineUtteranceRef.current = bumpPipelineUtterance;
  }, [bumpPipelineUtterance]);

  useEffect(() => {
    selectedOutputIdRef.current = selectedOutputId;
  }, [selectedOutputId]);

  const queueTranslationReplay = useCallback((audio: ArrayBuffer) => {
    const buf = audio.slice(0);
    voicePlayChainRef.current = voicePlayChainRef.current
      .then(() => playMp3OnDeviceSink(buf, selectedOutputIdRef.current))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Reprodução da tradução falhou");
      });
  }, []);

  const copyJournalPayloadJson = useCallback(async (line: TranscriptLineEntry) => {
    if (!line.journalDate) {
      return;
    }
    try {
      const payload = {
        journalKey: line.journalKey,
        date: line.journalDate,
        chatSpeaker: line.chatSpeaker,
        voice_id: line.voiceId ?? "",
        ...(line.voiceLabel
          ? { voice_label: line.voiceLabel }
          : {}),
        fraseusuario: line.pt,
        frasetranformada: line.en ?? "",
        audiobase64: line.audioBase64 ?? "",
        selected: line.replayCount ?? 0,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      setError("Não foi possível copiar o registo (JSON).");
    }
  }, []);

  const copyJournalPlainTexts = useCallback(async (line: TranscriptLineEntry) => {
    try {
      const parts = [line.pt, line.en].filter(
        (x): x is string => typeof x === "string" && x.length > 0
      );
      await navigator.clipboard.writeText(parts.join("\n\n"));
    } catch {
      setError("Não foi possível copiar os textos.");
    }
  }, []);

  const copyVocabularyRowJson = useCallback(async (row: TranscriptJournalRow) => {
    try {
      const payload = {
        journalKey: row.journalKey,
        date: row.date,
        voice_id: row.voice_id,
        ...(row.voice_label ? { voice_label: row.voice_label } : {}),
        fraseusuario: row.fraseusuario,
        frasetranformada: row.frasetranformada,
        audiobase64: row.audiobase64,
        selected: row.selected,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      setError("Não foi possível copiar o registo.");
    }
  }, []);

  const copyVocabularyPlainTexts = useCallback(async (row: TranscriptJournalRow) => {
    try {
      await navigator.clipboard.writeText(
        [row.fraseusuario, row.frasetranformada].filter(Boolean).join("\n\n")
      );
    } catch {
      setError("Não foi possível copiar os textos.");
    }
  }, []);

  const refreshVocabulary = useCallback(async () => {
    setVocabularyRegistryLoading(true);
    try {
      const buckets = await listJournalVoiceBuckets();
      setVocabularyVoiceBuckets(buckets);
      setVocabularySelectedVoiceId((prev) => {
        if (buckets.length === 0) {
          return "";
        }
        if (prev && buckets.some((b) => b.voiceId === prev)) {
          return prev;
        }
        return buckets[0]!.voiceId;
      });
    } finally {
      setVocabularyRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sidebarSection !== "vocabulary") {
      return;
    }
    void refreshVocabulary();
  }, [sidebarSection, refreshVocabulary]);

  useEffect(() => {
    if (sidebarSection !== "vocabulary") {
      return;
    }
    const vid =
      vocabularySelectedVoiceId ||
      vocabularyVoiceBuckets[0]?.voiceId ||
      "";
    if (!vid) {
      setVocabularyRows([]);
      setVocabularyLoading(false);
      return;
    }
    let cancelled = false;
    setVocabularyLoading(true);
    void listTranscriptJournalRowsForVoice(vid).then((rows) => {
      if (!cancelled) {
        setVocabularyRows(rows);
        setVocabularyLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    sidebarSection,
    vocabularySelectedVoiceId,
    vocabularyVoiceBuckets,
  ]);

  const playVocabularyRowAudio = useCallback((row: TranscriptJournalRow) => {
    try {
      if (!row.audiobase64) {
        return;
      }
      const buf = decodeBase64ToArrayBuffer(row.audiobase64);
      setVocabularyRows((prev) => {
        const cur = prev.find((r) => r.journalKey === row.journalKey);
        if (!cur) {
          return prev;
        }
        const nextSel = cur.selected + 1;
        void patchTranscriptJournalSelected(
          row.journalKey,
          nextSel,
          row.voice_id ?? ""
        );
        return prev.map((r) =>
          r.journalKey === row.journalKey ? { ...r, selected: nextSel } : r
        );
      });
      void playMp3OnDeviceSink(buf, selectedOutputIdRef.current);
    } catch {
      setError("Não foi possível reproduzir o áudio.");
    }
  }, []);

  const deleteVocabularyRow = useCallback(
    (row: TranscriptJournalRow) => {
      const key = row.journalKey;
      void (async () => {
        const ok = await deleteTranscriptJournalRow(key, row.voice_id ?? "");
        if (ok) {
          setVocabularyRows((prev) =>
            prev.filter((r) => r.journalKey !== key)
          );
          await refreshVocabulary();
        } else {
          setError("Não foi possível excluir a entrada.");
        }
      })();
    },
    [refreshVocabulary]
  );

  const runVoiceTranslationPlayback = useCallback(
    (lineId: number, pt: string, journalKey: string) => {
      voicePlayChainRef.current = voicePlayChainRef.current.then(async () => {
        try {
          const sel = selectedElevenLabsVoiceIdRef.current.trim();
          const st = voiceTranslationBackendStatusRef.current;
          const srv = (st?.elevenLabsVoiceId ?? "").trim();
          const apiVoiceId = sel || undefined;
          const cacheVoiceId = sel || srv || "_default";
          const { translatedText, audio, origin } =
            await fetchTranslatedVoiceAudioWithText(pt, {
              elevenLabsVoiceId: apiVoiceId,
              cacheVoiceId,
            });
          const audioCopy = audio.slice(0);
          const b64 = arrayBufferToBase64Mp3(audioCopy);
          const date = new Date().toISOString();
          const voiceId = voiceIdForTranslationRef.current.trim();
          const voiceLabel = labelForElevenLabsVoiceId(
            voiceId,
            elevenLabsVoiceLabelsRef.current
          );
          const persist = isSubstantivePhraseForJournal(pt, translatedText);
          const duplicate =
            persist &&
            (await hasJournalUserPhraseDuplicateForVoice(
              pt,
              voiceIdForTranslationRef.current.trim()
            ));
          const persistJournal = persist && !duplicate;
          if (persistJournal) {
            await upsertTranscriptJournalRow({
              journalKey,
              date,
              voice_id: voiceId,
              ...(voiceLabel ? { voice_label: voiceLabel } : {}),
              fraseusuario: pt,
              frasetranformada: translatedText,
              audiobase64: b64,
              selected: 0,
            });
          }
          setTranscriptLines((prev) =>
            prev.map((line) =>
              line.id === lineId
                ? {
                    ...line,
                    en: translatedText,
                    translationAudio: audioCopy,
                    translationOrigin: origin,
                    ...(persistJournal
                      ? {
                          journalDate: date,
                          voiceId,
                          ...(voiceLabel ? { voiceLabel } : {}),
                          audioBase64: b64,
                          replayCount: 0,
                        }
                      : {}),
                  }
                : line
            )
          );
          await playMp3OnDeviceSink(audioCopy, selectedOutputIdRef.current);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Tradução com voz falhou");
        }
      });
    },
    []
  );

  useEffect(() => {
    handleSttFinalRef.current = (text: string) => {
      if (!sttFinalTextPassesQualityGate(text)) {
        setInterimTranscript("");
        return;
      }
      bumpPipelineUtteranceRef.current();
      setInterimTranscript("");
      const id = (transcriptLineIdRef.current += 1);
      const journalKey = createTranscriptJournalKey();
      setTranscriptLines((prev) => [
        ...prev,
        { id, journalKey, chatSpeaker: "self", pt: text },
      ]);
      if (voiceTranslationEnabled && text.trim()) {
        runVoiceTranslationPlayback(id, text.trim(), journalKey);
      }
    };
  }, [voiceTranslationEnabled, runVoiceTranslationPlayback]);

  useEffect(() => {
    return subscribeEchoLinkChatAppend((payload) => {
      const text = payload.pt.trim();
      if (!text || !sttFinalTextPassesQualityGate(text)) {
        return;
      }
      bumpPipelineUtteranceRef.current();
      const id = (transcriptLineIdRef.current += 1);
      const journalKey = createTranscriptJournalKey();
      const speaker = payload.speaker;
      setTranscriptLines((prev) => [
        ...prev,
        { id, journalKey, chatSpeaker: speaker, pt: text },
      ]);
      if (voiceTranslationEnabled && text) {
        runVoiceTranslationPlayback(id, text, journalKey);
      }
    });
  }, [voiceTranslationEnabled, runVoiceTranslationPlayback]);

  useEffect(() => {
    voiceTranslationBackendStatusRef.current = voiceTranslationBackendStatus;
    selectedElevenLabsVoiceIdRef.current = settings.selectedElevenLabsVoiceId;
    const sel = settings.selectedElevenLabsVoiceId.trim();
    const srv = (voiceTranslationBackendStatus?.elevenLabsVoiceId ?? "").trim();
    voiceIdForTranslationRef.current = sel || srv;
  }, [
    settings.selectedElevenLabsVoiceId,
    voiceTranslationBackendStatus,
  ]);

  useEffect(() => {
    if (!voiceTranslationEnabled) {
      setVoiceTranslationBackendStatus(null);
      setElevenLabsVoicesFromApi(null);
      setElevenLabsVoicesLoading(false);
      return;
    }
    let cancelled = false;
    void fetchVoiceTranslationStatus()
      .then((s) => {
        if (!cancelled) setVoiceTranslationBackendStatus(s);
      })
      .catch(() => {
        if (!cancelled) setVoiceTranslationBackendStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [voiceTranslationEnabled]);

  useEffect(() => {
    if (!voiceTranslationEnabled) {
      return;
    }
    let cancelled = false;
    setElevenLabsVoicesLoading(true);
    void fetchElevenLabsVoices()
      .then((list) => {
        if (cancelled) return;
        setElevenLabsVoicesFromApi(list.length > 0 ? list : null);
      })
      .catch(() => {
        if (cancelled) return;
        setElevenLabsVoicesFromApi(null);
      })
      .finally(() => {
        if (cancelled) return;
        setElevenLabsVoicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [voiceTranslationEnabled]);

  useEffect(() => {
    setPipelineVisibleDoneCount(0);
  }, [pipelineUtteranceVersion]);

  const stopServiceStt = useCallback(() => {
    serviceSttCleanupRef.current?.();
    serviceSttCleanupRef.current = null;
    setServiceSttReady(false);
    setServiceSttFailed(false);
    setServiceSttBootstrapError(null);
    setInterimTranscript("");
  }, []);

  const refreshMediaDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(list.filter((d) => d.kind === "audioinput"));
      setAudioOutputs(list.filter((d) => d.kind === "audiooutput"));
    } catch {
      setError("Não foi possível listar dispositivos de áudio.");
    }
  }, []);

  useEffect(() => {
    void refreshMediaDevices();
    const md = navigator.mediaDevices;
    const onChange = () => {
      void refreshMediaDevices();
    };
    md.addEventListener("devicechange", onChange);
    return () => md.removeEventListener("devicechange", onChange);
  }, [refreshMediaDevices]);

  useEffect(() => {
    if (sidebarSection !== "info") {
      return;
    }
    void refreshMediaDevices();
  }, [sidebarSection, refreshMediaDevices]);

  useEffect(() => {
    if (
      selectedInputId &&
      !audioInputs.some((d) => d.deviceId === selectedInputId)
    ) {
      setSelectedInputId("");
    }
  }, [audioInputs, selectedInputId]);

  useEffect(() => {
    if (!selectedSecondaryInputId) return;
    if (
      !audioInputs.some((d) => d.deviceId === selectedSecondaryInputId) ||
      selectedSecondaryInputId === selectedInputId
    ) {
      setSelectedSecondaryInputId("");
      setSettings((prev) => ({
        ...prev,
        selectedSecondaryInputDeviceId: "",
      }));
      saveEchoLinkSettingsToStorage({ selectedSecondaryInputDeviceId: "" });
    }
  }, [audioInputs, selectedSecondaryInputId, selectedInputId]);

  useEffect(() => {
    if (!selectedTertiaryInputId) return;
    if (
      !audioInputs.some((d) => d.deviceId === selectedTertiaryInputId) ||
      selectedTertiaryInputId === selectedInputId ||
      selectedTertiaryInputId === selectedSecondaryInputId
    ) {
      setSelectedTertiaryInputId("");
      setSettings((prev) => ({
        ...prev,
        selectedTertiaryInputDeviceId: "",
      }));
      saveEchoLinkSettingsToStorage({ selectedTertiaryInputDeviceId: "" });
    }
  }, [
    audioInputs,
    selectedTertiaryInputId,
    selectedInputId,
    selectedSecondaryInputId,
  ]);

  useEffect(() => {
    if (
      selectedOutputId &&
      !audioOutputs.some((d) => d.deviceId === selectedOutputId)
    ) {
      setSelectedOutputId("");
    }
  }, [audioOutputs, selectedOutputId]);

  const unlockMediaLabels = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: withIdealMultiChannelCapture({}),
      });
      s.getTracks().forEach((t) => t.stop());
      await refreshMediaDevices();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Permissão negada";
      setError(msg);
    }
  };

  const stopPipelineOutLevelLoop = useCallback(() => {
    if (pipelineOutRafRef.current) {
      cancelAnimationFrame(pipelineOutRafRef.current);
      pipelineOutRafRef.current = 0;
    }
    pipelineOutputAnalyserRef.current = null;
    pipelineOutBufRef.current = null;
    pipelineOutSmoothRef.current = 0;
    setPipelineOutVu(0);
  }, []);

  const stopMeterLoop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    stopPipelineOutLevelLoop();
    pipelineBranchCleanupRef.current?.();
    pipelineBranchCleanupRef.current = null;
    pipelineGainNodeRef.current = null;
    mediaStreamSourceRef.current = null;
    pipelineMonitorSourceRef.current = null;
    const meterCtx = audioContextRef.current;
    audioContextRef.current = null;
    safeCloseAudioContext(meterCtx);
    analyserRef.current = null;
    mixPrimaryAnalyserRef.current = null;
    mixSecondaryAnalyserRef.current = null;
    mixTertiaryAnalyserRef.current = null;
    timeDomainRef.current = null;
    timeDomainSecondaryRef.current = null;
    timeDomainTertiaryRef.current = null;
    rxPulseRef.current = 0;
    micVuSmoothRef.current = 0;
    lineVuSmoothRef.current = 0;
    mediaVuSmoothRef.current = 0;
    setMicVu(0);
    setLineVu(0);
    setMediaVu(0);
    setRxLevel(0);
    setMeterSampleRate(0);
    setPipelineBranchLive(false);
  }, [stopPipelineOutLevelLoop]);

  const stopAll = useCallback(() => {
    const sid = captureChatSessionIdRef.current;
    if (sid) {
      void putEchoLinkChatSessionSnapshot(sid, {
        messages: serializeChatLinesForService(transcriptLinesRef.current),
        interimPt: null,
        ended: true,
      });
    }
    captureChatSessionIdRef.current = null;
    setCaptureChatSessionId(null);
    voicePlayChainRef.current = Promise.resolve();
    stopServiceStt();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    captureGainControlsRef.current = null;
    stopMeterLoop();
    mixDisposeRef.current?.();
    mixDisposeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setRunning(false);
    setConnected(false);
    void postEchoLinkRuntimeCapture(false);
  }, [stopMeterLoop, stopServiceStt]);

  useEffect(() => {
    return () => {
      stopAll();
      testStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [stopAll]);

  const startPipelineOutLevelLoop = useCallback(() => {
    if (pipelineOutRafRef.current) {
      cancelAnimationFrame(pipelineOutRafRef.current);
      pipelineOutRafRef.current = 0;
    }
    const tick = () => {
      try {
        const a = pipelineOutputAnalyserRef.current;
        let buf = pipelineOutBufRef.current;
        if (a) {
          if (!buf || buf.length !== a.fftSize) {
            buf = createByteDomainBuffer(a.fftSize);
            pipelineOutBufRef.current = buf;
          }
          a.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const instant = mapRmsToMeterLevel(rms, 100);
          pipelineOutSmoothRef.current = smoothVuLevel(
            pipelineOutSmoothRef.current,
            instant
          );
          setPipelineOutVu(pipelineOutSmoothRef.current);
        } else {
          const d = smoothVuLevel(pipelineOutSmoothRef.current, 0);
          pipelineOutSmoothRef.current = d;
          setPipelineOutVu(d);
          if (d <= 0) {
            pipelineOutRafRef.current = 0;
            return;
          }
        }
      } catch {}
      pipelineOutRafRef.current = requestAnimationFrame(tick);
    };
    pipelineOutRafRef.current = requestAnimationFrame(tick);
  }, []);

  const startMeter = useCallback(
    async (
      stream: MediaStream,
      withRx: boolean,
      pipelineStream?: MediaStream
    ) => {
      micVuSmoothRef.current = 0;
      lineVuSmoothRef.current = 0;
      mediaVuSmoothRef.current = 0;
      const ctx = new AudioContext();
      await ctx.resume().catch(() => undefined);
      setMeterSampleRate(ctx.sampleRate);
      const source = ctx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;
      if (pipelineStream && pipelineStream !== stream) {
        pipelineMonitorSourceRef.current =
          ctx.createMediaStreamSource(pipelineStream);
      } else {
        pipelineMonitorSourceRef.current = source;
      }
      const mixP = mixPrimaryAnalyserRef.current;
      const mixS = mixSecondaryAnalyserRef.current;
      const mixT = mixTertiaryAnalyserRef.current;
      if (mixP) {
        analyserRef.current = null;
        timeDomainRef.current = createByteDomainBuffer(mixP.fftSize);
        timeDomainSecondaryRef.current = mixS
          ? createByteDomainBuffer(mixS.fftSize)
          : null;
        timeDomainTertiaryRef.current = mixT
          ? createByteDomainBuffer(mixT.fftSize)
          : null;
      } else {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.75;
        applyMaxChannelWebAudioNodes(analyser);
        source.connect(analyser);
        analyserRef.current = analyser;
        timeDomainRef.current = createByteDomainBuffer(analyser.fftSize);
        timeDomainSecondaryRef.current = null;
        timeDomainTertiaryRef.current = null;
      }
      audioContextRef.current = ctx;

      const tick = () => {
        try {
        const sens = inputSensitivityRef.current;
        const mp = mixPrimaryAnalyserRef.current;
        const ms = mixSecondaryAnalyserRef.current;
        const mt = mixTertiaryAnalyserRef.current;
        const fallbackA = analyserRef.current;
        const buf1 = timeDomainRef.current;
        const buf2 = timeDomainSecondaryRef.current;
        const buf3 = timeDomainTertiaryRef.current;
        if (mp && buf1) {
          mp.getByteTimeDomainData(buf1);
          let sum = 0;
          for (let i = 0; i < buf1.length; i++) {
            const v = (buf1[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf1.length);
          const instant = mapRmsToMeterLevel(rms, sens);
          micVuSmoothRef.current = smoothVuLevel(
            micVuSmoothRef.current,
            instant
          );
          setMicVu(micVuSmoothRef.current);
        } else if (fallbackA && buf1) {
          fallbackA.getByteTimeDomainData(buf1);
          let sum = 0;
          for (let i = 0; i < buf1.length; i++) {
            const v = (buf1[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf1.length);
          const instant = mapRmsToMeterLevel(rms, sens);
          micVuSmoothRef.current = smoothVuLevel(
            micVuSmoothRef.current,
            instant
          );
          setMicVu(micVuSmoothRef.current);
        } else {
          micVuSmoothRef.current = smoothVuLevel(micVuSmoothRef.current, 0);
          setMicVu(micVuSmoothRef.current);
        }
        if (ms && buf2) {
          ms.getByteTimeDomainData(buf2);
          let sum2 = 0;
          for (let i = 0; i < buf2.length; i++) {
            const v = (buf2[i] - 128) / 128;
            sum2 += v * v;
          }
          const rms2 = Math.sqrt(sum2 / buf2.length);
          const instant2 = mapRmsToMeterLevel(
            rms2,
            LINE_CHANNEL_VU_SENSITIVITY_PERCENT
          );
          lineVuSmoothRef.current = smoothVuLevel(
            lineVuSmoothRef.current,
            instant2
          );
          setLineVu(lineVuSmoothRef.current);
        } else {
          lineVuSmoothRef.current = smoothVuLevel(lineVuSmoothRef.current, 0);
          setLineVu(lineVuSmoothRef.current);
        }
        if (mt && buf3) {
          mt.getByteTimeDomainData(buf3);
          let sum3 = 0;
          for (let i = 0; i < buf3.length; i++) {
            const v = (buf3[i] - 128) / 128;
            sum3 += v * v;
          }
          const rms3 = Math.sqrt(sum3 / buf3.length);
          const instant3 = mapRmsToMeterLevel(
            rms3,
            LINE_CHANNEL_VU_SENSITIVITY_PERCENT
          );
          mediaVuSmoothRef.current = smoothVuLevel(
            mediaVuSmoothRef.current,
            instant3
          );
          setMediaVu(mediaVuSmoothRef.current);
        } else {
          mediaVuSmoothRef.current = smoothVuLevel(
            mediaVuSmoothRef.current,
            0
          );
          setMediaVu(mediaVuSmoothRef.current);
        }
        if (withRx) {
          rxPulseRef.current *= RX_DECAY;
          setRxLevel(rxPulseRef.current);
        }
        } catch {}
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    []
  );

  const testMicrophone = async () => {
    if (running || micTesting || outputTesting) return;
    setError(null);
    setMicTesting(true);
    try {
      const audioConstraints = withIdealMultiChannelCapture({
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      });
      if (selectedInputId) {
        audioConstraints.deviceId = { exact: selectedInputId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      testStreamRef.current = stream;
      await startMeter(stream, false, undefined);
      await new Promise((r) => setTimeout(r, MIC_TEST_MS));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Teste do microfone falhou";
      setError(msg);
    } finally {
      testStreamRef.current?.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
      stopMeterLoop();
      setMicTesting(false);
    }
  };

  const testOutput = async () => {
    if (running || outputTesting || micTesting) return;
    setError(null);
    setOutputTesting(true);
    try {
      await playTestBeep(selectedOutputId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Teste de saída falhou";
      setError(msg);
    } finally {
      setOutputTesting(false);
    }
  };

  const start = async () => {
    setCaptureStarting(true);
    setError(null);
    captureChatSessionIdRef.current = null;
    setCaptureChatSessionId(null);
    setServiceBytes(0);
    setServiceChunks(0);
    setServiceChunksBaseline(0);
    setTranscriptLines([]);
    transcriptLineIdRef.current = 0;
    setInterimTranscript("");
    setServiceSttReady(false);
    setServiceSttFailed(false);
    setServiceSttBootstrapError(null);
    setPipelineUtteranceVersion((v) => v + 1);
    rxPulseRef.current = 0;
    let primaryForCleanup: MediaStream | null = null;
    let secondaryForCleanup: MediaStream | null = null;
    let tertiaryForCleanup: MediaStream | null = null;
    try {
      const baseAudio = withIdealMultiChannelCapture({
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false,
      });
      const primaryConstraints: MediaTrackConstraints = { ...baseAudio };
      if (selectedInputId) {
        primaryConstraints.deviceId = { exact: selectedInputId };
      }
      primaryForCleanup = await navigator.mediaDevices.getUserMedia({
        audio: primaryConstraints,
      });
      let captureStream: MediaStream;
      const secondaryId =
        selectedSecondaryInputId &&
        selectedSecondaryInputId !== selectedInputId
          ? selectedSecondaryInputId
          : "";
      const tertiaryId =
        selectedTertiaryInputId &&
        selectedTertiaryInputId !== selectedInputId &&
        selectedTertiaryInputId !== secondaryId
          ? selectedTertiaryInputId
          : "";
      const pLin = Math.max(
        0,
        Math.min(2, settings.primaryChannelMixGainPercent / 100)
      );
      const sLin = Math.max(
        0,
        Math.min(2, settings.secondaryChannelMixGainPercent / 100)
      );
      const tLin = Math.max(
        0,
        Math.min(2, settings.tertiaryChannelMixGainPercent / 100)
      );
      const monitorExcludePrimary = voiceTranslationEnabledRef.current;
      let pipelineStreamForMeter: MediaStream | undefined;
      captureGainControlsRef.current = null;
      mixPrimaryAnalyserRef.current = null;
      mixSecondaryAnalyserRef.current = null;
      mixTertiaryAnalyserRef.current = null;
      if (secondaryId && tertiaryId) {
        const secondaryConstraints: MediaTrackConstraints = { ...baseAudio };
        secondaryConstraints.deviceId = { exact: secondaryId };
        secondaryForCleanup = await navigator.mediaDevices.getUserMedia({
          audio: secondaryConstraints,
        });
        const tertiaryConstraints: MediaTrackConstraints = { ...baseAudio };
        tertiaryConstraints.deviceId = { exact: tertiaryId };
        tertiaryForCleanup = await navigator.mediaDevices.getUserMedia({
          audio: tertiaryConstraints,
        });
        const {
          mixedStream,
          monitorStream,
          dispose,
          controls,
          primaryAnalyser,
          secondaryAnalyser,
          tertiaryAnalyser,
        } = await mixCaptureAudioStreamsTriple(
          primaryForCleanup,
          secondaryForCleanup,
          tertiaryForCleanup,
          {
            primaryLinear: pLin,
            secondaryLinear: sLin,
            tertiaryLinear: tLin,
            monitorExcludePrimary: monitorExcludePrimary,
          }
        );
        mixDisposeRef.current = dispose;
        mixPrimaryAnalyserRef.current = primaryAnalyser;
        mixSecondaryAnalyserRef.current = secondaryAnalyser;
        mixTertiaryAnalyserRef.current = tertiaryAnalyser;
        captureGainControlsRef.current = {
          mode: "triple",
          setPrimaryLinear: controls.setPrimaryLinear,
          setSecondaryLinear: controls.setSecondaryLinear,
          setTertiaryLinear: controls.setTertiaryLinear,
        };
        primaryForCleanup = null;
        secondaryForCleanup = null;
        tertiaryForCleanup = null;
        captureStream = mixedStream;
        pipelineStreamForMeter =
          monitorStream !== mixedStream ? monitorStream : undefined;
      } else if (secondaryId) {
        const secondaryConstraints: MediaTrackConstraints = { ...baseAudio };
        secondaryConstraints.deviceId = { exact: secondaryId };
        secondaryForCleanup = await navigator.mediaDevices.getUserMedia({
          audio: secondaryConstraints,
        });
        const {
          mixedStream,
          monitorStream,
          dispose,
          controls,
          primaryAnalyser,
          secondaryAnalyser,
        } = await mixCaptureAudioStreams(primaryForCleanup, secondaryForCleanup, {
          primaryLinear: pLin,
          secondaryLinear: sLin,
          monitorExcludePrimary: monitorExcludePrimary,
        });
        mixDisposeRef.current = dispose;
        mixPrimaryAnalyserRef.current = primaryAnalyser;
        mixSecondaryAnalyserRef.current = secondaryAnalyser;
        mixTertiaryAnalyserRef.current = null;
        captureGainControlsRef.current = {
          mode: "dual",
          setPrimaryLinear: controls.setPrimaryLinear,
          setSecondaryLinear: controls.setSecondaryLinear,
        };
        primaryForCleanup = null;
        secondaryForCleanup = null;
        captureStream = mixedStream;
        pipelineStreamForMeter =
          monitorStream !== mixedStream ? monitorStream : undefined;
      } else if (tertiaryId) {
        const tertiaryConstraints: MediaTrackConstraints = { ...baseAudio };
        tertiaryConstraints.deviceId = { exact: tertiaryId };
        tertiaryForCleanup = await navigator.mediaDevices.getUserMedia({
          audio: tertiaryConstraints,
        });
        const {
          mixedStream,
          monitorStream,
          dispose,
          controls,
          primaryAnalyser,
          secondaryAnalyser,
        } = await mixCaptureAudioStreams(primaryForCleanup, tertiaryForCleanup, {
          primaryLinear: pLin,
          secondaryLinear: tLin,
          monitorExcludePrimary: monitorExcludePrimary,
        });
        mixDisposeRef.current = dispose;
        mixPrimaryAnalyserRef.current = primaryAnalyser;
        mixSecondaryAnalyserRef.current = null;
        mixTertiaryAnalyserRef.current = secondaryAnalyser;
        captureGainControlsRef.current = {
          mode: "dual",
          setPrimaryLinear: controls.setPrimaryLinear,
          setSecondaryLinear: controls.setSecondaryLinear,
        };
        primaryForCleanup = null;
        tertiaryForCleanup = null;
        captureStream = mixedStream;
        pipelineStreamForMeter =
          monitorStream !== mixedStream ? monitorStream : undefined;
      } else {
        const pt = await passThroughCaptureWithGain(primaryForCleanup, pLin, {
          monitorExcludePrimary: monitorExcludePrimary,
        });
        mixDisposeRef.current = pt.dispose;
        mixPrimaryAnalyserRef.current = pt.primaryAnalyser;
        mixSecondaryAnalyserRef.current = null;
        mixTertiaryAnalyserRef.current = null;
        captureGainControlsRef.current = {
          mode: "single",
          setPrimaryLinear: pt.setGainLinear,
        };
        primaryForCleanup = null;
        captureStream = pt.stream;
        pipelineStreamForMeter =
          pt.monitorStream !== pt.stream ? pt.monitorStream : undefined;
      }
      streamRef.current = captureStream;
      await startMeter(captureStream, true, pipelineStreamForMeter);

      const ws = openEchoLinkServiceWebSocket("/ws/mic");
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          setConnected(true);
          resolve();
        };
        ws.onerror = () =>
          reject(new Error("Falha na conexão WebSocket com o serviço."));
      });

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as {
            totalBytes?: number;
            chunks?: number;
          };
          if (typeof data.totalBytes === "number") {
            setServiceBytes(data.totalBytes);
          }
          if (typeof data.chunks === "number") {
            setServiceChunks(data.chunks);
          }
          rxPulseRef.current = Math.min(1, rxPulseRef.current + RX_SPIKE);
        } catch {
          /* ignore non-json */
        }
      };

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(captureStream, { mimeType })
        : new MediaRecorder(captureStream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e: BlobEvent) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          const buf = await e.data.arrayBuffer();
          ws.send(buf);
        }
      };

      recorder.start(settings.audioChunkMs);
      const chatSess = await postEchoLinkChatSession();
      const newChatId = chatSess?.sessionId ?? null;
      captureChatSessionIdRef.current = newChatId;
      setCaptureChatSessionId(newChatId);
      setRunning(true);
      void postEchoLinkRuntimeCapture(true);
      if (settings.transcriptionStartDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, settings.transcriptionStartDelayMs);
        });
      }
      if (settings.speechLanguagesEnabled) {
        const ctx = audioContextRef.current;
        const src = mediaStreamSourceRef.current;
        if (!ctx || !src) {
          const msg = "STT: contexto de áudio indisponível.";
          setServiceSttFailed(true);
          setServiceSttBootstrapError(msg);
          setError(msg);
        } else {
          try {
            const cleanup = await startServiceSttSession(ctx, src, (ev) => {
              if (ev.kind === "partial") {
                setInterimTranscript(ev.text);
              }
              if (ev.kind === "final") {
                handleSttFinalRef.current(ev.text);
              }
              if (ev.kind === "error") {
                setError(ev.message);
              }
            });
            serviceSttCleanupRef.current = cleanup;
            setServiceSttReady(true);
            setServiceSttFailed(false);
            setServiceSttBootstrapError(null);
          } catch (sttErr) {
            setServiceSttFailed(true);
            setServiceSttReady(false);
            const msg =
              sttErr instanceof Error
                ? sttErr.message
                : "STT: falha ao iniciar sessão com o serviço Python.";
            setServiceSttBootstrapError(msg);
            setError(msg);
          }
        }
      }
    } catch (e) {
      mixDisposeRef.current?.();
      mixDisposeRef.current = null;
      mixPrimaryAnalyserRef.current = null;
      mixSecondaryAnalyserRef.current = null;
      mixTertiaryAnalyserRef.current = null;
      primaryForCleanup?.getTracks().forEach((t) => t.stop());
      secondaryForCleanup?.getTracks().forEach((t) => t.stop());
      tertiaryForCleanup?.getTracks().forEach((t) => t.stop());
      const msg =
        e instanceof Error ? e.message : "Não foi possível iniciar a captura.";
      setError(msg);
      stopAll();
    } finally {
      setCaptureStarting(false);
    }
  };

  useEffect(() => {
    const g =
      pipelineGainNodeRef.current ?? idlePreviewMonitorGainRef.current;
    if (g) {
      const outLin = Math.max(
        0,
        Math.min(2, settings.outputChannelMixGainPercent / 100)
      );
      const m = mixerOutputMute ? 0 : 1;
      g.gain.value = pipelineMonitorGain * outLin * m;
    }
  }, [
    pipelineMonitorGain,
    settings.outputChannelMixGainPercent,
    mixerOutputMute,
    pipelineBranchLive,
  ]);

  useEffect(() => {
    if (running) {
      return;
    }
    const gp = idlePreviewPrimGainRef.current;
    const gs = idlePreviewSecGainRef.current;
    const gt = idlePreviewTertGainRef.current;
    if (!gp && !gs && !gt) {
      return;
    }
    const ch2Ok =
      Boolean(selectedSecondaryInputId) &&
      selectedSecondaryInputId !== selectedInputId;
    const ch3Ok =
      Boolean(selectedTertiaryInputId) &&
      selectedTertiaryInputId !== selectedInputId &&
      selectedTertiaryInputId !== selectedSecondaryInputId;
    const pRaw = settings.primaryChannelMixGainPercent / 100;
    const sRaw = settings.secondaryChannelMixGainPercent / 100;
    const tRaw = settings.tertiaryChannelMixGainPercent / 100;
    const p =
      mixerActivate1 && !mixerMute1
        ? Math.max(0, Math.min(2, pRaw))
        : 0;
    const s =
      mixerActivate2 && !mixerMute2 && ch2Ok
        ? Math.max(0, Math.min(2, sRaw))
        : 0;
    const t =
      mixerActivate3 && !mixerMute3 && ch3Ok
        ? Math.max(0, Math.min(2, tRaw))
        : 0;
    if (gp) {
      gp.gain.value = IDLE_PREVIEW_MIX_HEADROOM * p;
    }
    if (gs) {
      gs.gain.value = IDLE_PREVIEW_MIX_HEADROOM * s;
    }
    if (gt) {
      gt.gain.value = IDLE_PREVIEW_MIX_HEADROOM * t;
    }
  }, [
    running,
    mixerActivate1,
    mixerMute1,
    mixerActivate2,
    mixerMute2,
    mixerActivate3,
    mixerMute3,
    settings.primaryChannelMixGainPercent,
    settings.secondaryChannelMixGainPercent,
    settings.tertiaryChannelMixGainPercent,
    selectedSecondaryInputId,
    selectedTertiaryInputId,
    selectedInputId,
  ]);

  useEffect(() => {
    if (!running) return;
    const c = captureGainControlsRef.current;
    if (!c) return;
    const ch2Ok =
      Boolean(selectedSecondaryInputId) &&
      selectedSecondaryInputId !== selectedInputId;
    const ch3Ok =
      Boolean(selectedTertiaryInputId) &&
      selectedTertiaryInputId !== selectedInputId &&
      selectedTertiaryInputId !== selectedSecondaryInputId;
    const pRaw = settings.primaryChannelMixGainPercent / 100;
    const sRaw = settings.secondaryChannelMixGainPercent / 100;
    const tRaw = settings.tertiaryChannelMixGainPercent / 100;
    const p =
      mixerActivate1 && !mixerMute1
        ? Math.max(0, Math.min(2, pRaw))
        : 0;
    const s =
      mixerActivate2 && !mixerMute2 && ch2Ok
        ? Math.max(0, Math.min(2, sRaw))
        : 0;
    const t =
      mixerActivate3 && !mixerMute3 && ch3Ok
        ? Math.max(0, Math.min(2, tRaw))
        : 0;
    c.setPrimaryLinear(p);
    if (c.mode === "dual") {
      const secOk =
        Boolean(selectedSecondaryInputId) &&
        selectedSecondaryInputId !== selectedInputId;
      const terOk =
        Boolean(selectedTertiaryInputId) &&
        selectedTertiaryInputId !== selectedInputId &&
        selectedTertiaryInputId !== selectedSecondaryInputId;
      c.setSecondaryLinear(secOk ? s : terOk ? t : 0);
    }
    if (c.mode === "triple") {
      c.setSecondaryLinear(s);
      c.setTertiaryLinear(t);
    }
  }, [
    running,
    mixerActivate1,
    mixerActivate2,
    mixerActivate3,
    mixerMute1,
    mixerMute2,
    mixerMute3,
    settings.primaryChannelMixGainPercent,
    settings.secondaryChannelMixGainPercent,
    settings.tertiaryChannelMixGainPercent,
    selectedSecondaryInputId,
    selectedTertiaryInputId,
    selectedInputId,
  ]);

  useEffect(() => {
    if (!mixerActivate1) {
      setMixerMute1((prev) => {
        if (prev) {
          return prev;
        }
        saveEchoLinkSettingsToStorage({ mixerChannel1Muted: true });
        return true;
      });
    }
  }, [mixerActivate1]);

  useEffect(() => {
    if (!mixerActivate2) {
      setMixerMute2((prev) => {
        if (prev) {
          return prev;
        }
        saveEchoLinkSettingsToStorage({ mixerChannel2Muted: true });
        return true;
      });
    }
  }, [mixerActivate2]);

  useEffect(() => {
    if (!mixerActivate3) {
      setMixerMute3((prev) => {
        if (prev) {
          return prev;
        }
        saveEchoLinkSettingsToStorage({ mixerChannel3Muted: true });
        return true;
      });
    }
  }, [mixerActivate3]);

  useEffect(() => {
    if (!running) return;
    const ctx = audioContextRef.current;
    const source =
      pipelineMonitorSourceRef.current ?? mediaStreamSourceRef.current;
    if (!ctx || !source) return;
    let cancelled = false;
    const run = async () => {
      setPipelineBranchLive(false);
      pipelineBranchCleanupRef.current?.();
      pipelineBranchCleanupRef.current = null;
      if (pipelineOutRafRef.current) {
        cancelAnimationFrame(pipelineOutRafRef.current);
        pipelineOutRafRef.current = 0;
      }
      pipelineGainNodeRef.current = null;
      pipelineOutputAnalyserRef.current = null;
      pipelineOutSmoothRef.current = 0;
      setPipelineOutVu(0);
      if (!pipelineMonitorEnabled) return;
      try {
        const branch = await connectMonitorBranch(ctx, source, {
          monitorGain: pipelineMonitorGainRef.current,
          outputDeviceId: selectedOutputId || undefined,
          inject: pipelineInjectRef.current,
        });
        if (cancelled) {
          branch.disconnect();
          return;
        }
        pipelineBranchCleanupRef.current = branch.disconnect;
        pipelineGainNodeRef.current = branch.gainNode;
        pipelineOutputAnalyserRef.current = branch.outputAnalyser;
        setPipelineBranchLive(true);
        startPipelineOutLevelLoop();
      } catch (e) {
        setPipelineBranchLive(false);
        const msg =
          e instanceof Error ? e.message : "Pipeline de monitoração falhou";
        setError(msg);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    running,
    pipelineMonitorEnabled,
    selectedOutputId,
    startPipelineOutLevelLoop,
  ]);

  const busy =
    running || micTesting || outputTesting || captureStarting;

  const idleInputGraphDepKey = useMemo(
    () =>
      [
        running,
        micTesting,
        outputTesting,
        captureStarting,
        mixerActivate1,
        mixerMute1,
        mixerActivate2,
        mixerMute2,
        mixerActivate3,
        mixerMute3,
        selectedInputId,
        selectedSecondaryInputId,
        selectedTertiaryInputId,
        voiceTranslationEnabled,
      ].join("\0"),
    [
      running,
      micTesting,
      outputTesting,
      captureStarting,
      mixerActivate1,
      mixerMute1,
      mixerActivate2,
      mixerMute2,
      mixerActivate3,
      mixerMute3,
      selectedInputId,
      selectedSecondaryInputId,
      selectedTertiaryInputId,
      voiceTranslationEnabled,
    ]
  );

  useEffect(() => {
    if (running || micTesting || outputTesting || captureStarting) {
      return;
    }
    let cancelled = false;
    let rafId = 0;
    const streams: MediaStream[] = [];
    let ctx: AudioContext | null = null;
    let an1: AnalyserNode | null = null;
    let an2: AnalyserNode | null = null;
    let an3: AnalyserNode | null = null;
    let ms1Node: MediaStreamAudioSourceNode | null = null;
    let ms2Node: MediaStreamAudioSourceNode | null = null;
    let ms3Node: MediaStreamAudioSourceNode | null = null;
    let previewMixDest: MediaStreamAudioDestinationNode | null = null;
    let previewSumGain: GainNode | null = null;

    const run = async () => {
      const ch2Ok =
        Boolean(selectedSecondaryInputId) &&
        selectedSecondaryInputId !== selectedInputId;
      const ch3Ok =
        Boolean(selectedTertiaryInputId) &&
        selectedTertiaryInputId !== selectedInputId &&
        selectedTertiaryInputId !== selectedSecondaryInputId;
      const want1 = mixerActivate1 && !mixerMute1;
      const want2 = mixerActivate2 && !mixerMute2 && ch2Ok;
      const want3 = mixerActivate3 && !mixerMute3 && ch3Ok;
      idlePreviewMixStreamRef.current = null;
      if (!want1 && !want2 && !want3) {
        setMicVu(0);
        setLineVu(0);
        setMediaVu(0);
        setMeterSampleRate(0);
        micVuSmoothRef.current = 0;
        lineVuSmoothRef.current = 0;
        mediaVuSmoothRef.current = 0;
        setIdleInputGraphSeq((n) => n + 1);
        return;
      }
      try {
        ctx = new AudioContext();
        await ctx.resume();
        if (cancelled) {
          safeCloseAudioContext(ctx);
          return;
        }
        setMeterSampleRate(ctx.sampleRate);
        const baseAudio = withIdealMultiChannelCapture({
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: false,
        });
        const silent = ctx.createGain();
        silent.gain.value = 0;
        silent.connect(ctx.destination);
        if (want1) {
          const c: MediaTrackConstraints = { ...baseAudio };
          if (selectedInputId) {
            c.deviceId = { exact: selectedInputId };
          }
          const s = await navigator.mediaDevices.getUserMedia({ audio: c });
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            safeCloseAudioContext(ctx);
            return;
          }
          streams.push(s);
          ms1Node = ctx.createMediaStreamSource(s);
          an1 = ctx.createAnalyser();
          an1.fftSize = 512;
          an1.smoothingTimeConstant = 0.75;
          applyMaxChannelWebAudioNodes(an1);
          ms1Node.connect(an1);
          an1.connect(silent);
        }
        if (want2) {
          const c: MediaTrackConstraints = {
            ...baseAudio,
            deviceId: { exact: selectedSecondaryInputId },
          };
          const s = await navigator.mediaDevices.getUserMedia({ audio: c });
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            safeCloseAudioContext(ctx);
            return;
          }
          streams.push(s);
          ms2Node = ctx.createMediaStreamSource(s);
          an2 = ctx.createAnalyser();
          an2.fftSize = 512;
          an2.smoothingTimeConstant = 0.75;
          applyMaxChannelWebAudioNodes(an2);
          ms2Node.connect(an2);
          an2.connect(silent);
        }
        if (want3) {
          const c: MediaTrackConstraints = {
            ...baseAudio,
            deviceId: { exact: selectedTertiaryInputId },
          };
          const s = await navigator.mediaDevices.getUserMedia({ audio: c });
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop());
            safeCloseAudioContext(ctx);
            return;
          }
          streams.push(s);
          ms3Node = ctx.createMediaStreamSource(s);
          an3 = ctx.createAnalyser();
          an3.fftSize = 512;
          an3.smoothingTimeConstant = 0.75;
          applyMaxChannelWebAudioNodes(an3);
          ms3Node.connect(an3);
          an3.connect(silent);
        }
        const buf1 = an1 ? createByteDomainBuffer(an1.fftSize) : null;
        const buf2 = an2 ? createByteDomainBuffer(an2.fftSize) : null;
        const buf3 = an3 ? createByteDomainBuffer(an3.fftSize) : null;
        micVuSmoothRef.current = 0;
        lineVuSmoothRef.current = 0;
        mediaVuSmoothRef.current = 0;
        const tick = () => {
          if (cancelled) {
            return;
          }
          try {
            const sens = inputSensitivityRef.current;
            if (an1 && buf1) {
              an1.getByteTimeDomainData(buf1);
              let sum = 0;
              for (let i = 0; i < buf1.length; i++) {
                const v = (buf1[i] - 128) / 128;
                sum += v * v;
              }
              const rms = Math.sqrt(sum / buf1.length);
              const instant = mapRmsToMeterLevel(rms, sens);
              micVuSmoothRef.current = smoothVuLevel(
                micVuSmoothRef.current,
                instant
              );
              setMicVu(micVuSmoothRef.current);
            } else {
              micVuSmoothRef.current = smoothVuLevel(
                micVuSmoothRef.current,
                0
              );
              setMicVu(micVuSmoothRef.current);
            }
            if (an2 && buf2) {
              an2.getByteTimeDomainData(buf2);
              let sum2 = 0;
              for (let i = 0; i < buf2.length; i++) {
                const v = (buf2[i] - 128) / 128;
                sum2 += v * v;
              }
              const rms2 = Math.sqrt(sum2 / buf2.length);
              const instant2 = mapRmsToMeterLevel(
                rms2,
                LINE_CHANNEL_VU_SENSITIVITY_PERCENT
              );
              lineVuSmoothRef.current = smoothVuLevel(
                lineVuSmoothRef.current,
                instant2
              );
              setLineVu(lineVuSmoothRef.current);
            } else {
              lineVuSmoothRef.current = smoothVuLevel(
                lineVuSmoothRef.current,
                0
              );
              setLineVu(lineVuSmoothRef.current);
            }
            if (an3 && buf3) {
              an3.getByteTimeDomainData(buf3);
              let sum3 = 0;
              for (let i = 0; i < buf3.length; i++) {
                const v = (buf3[i] - 128) / 128;
                sum3 += v * v;
              }
              const rms3 = Math.sqrt(sum3 / buf3.length);
              const instant3 = mapRmsToMeterLevel(
                rms3,
                LINE_CHANNEL_VU_SENSITIVITY_PERCENT
              );
              mediaVuSmoothRef.current = smoothVuLevel(
                mediaVuSmoothRef.current,
                instant3
              );
              setMediaVu(mediaVuSmoothRef.current);
            } else {
              mediaVuSmoothRef.current = smoothVuLevel(
                mediaVuSmoothRef.current,
                0
              );
              setMediaVu(mediaVuSmoothRef.current);
            }
          } catch {}
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        const ch2OkMix =
          Boolean(selectedSecondaryInputId) &&
          selectedSecondaryInputId !== selectedInputId;
        const ch3OkMix =
          Boolean(selectedTertiaryInputId) &&
          selectedTertiaryInputId !== selectedInputId &&
          selectedTertiaryInputId !== selectedSecondaryInputId;
        const pLin =
          mixerActivate1 && !mixerMute1
            ? Math.max(
                0,
                Math.min(
                  2,
                  settings.primaryChannelMixGainPercent / 100
                )
              )
            : 0;
        const sLin =
          mixerActivate2 && !mixerMute2 && ch2OkMix
            ? Math.max(
                0,
                Math.min(
                  2,
                  settings.secondaryChannelMixGainPercent / 100
                )
              )
            : 0;
        const tLin =
          mixerActivate3 && !mixerMute3 && ch3OkMix
            ? Math.max(
                0,
                Math.min(
                  2,
                  settings.tertiaryChannelMixGainPercent / 100
                )
              )
            : 0;
        if ((want1 || want2 || want3) && !cancelled) {
          previewSumGain = ctx.createGain();
          previewSumGain.gain.value = 1;
          previewMixDest = ctx.createMediaStreamDestination();
          previewSumGain.connect(previewMixDest);
          idlePreviewPrimGainRef.current = null;
          idlePreviewSecGainRef.current = null;
          idlePreviewTertGainRef.current = null;
          if (want1 && ms1Node) {
            const gP = ctx.createGain();
            gP.gain.value = IDLE_PREVIEW_MIX_HEADROOM * pLin;
            ms1Node.connect(gP);
            if (!voiceTranslationEnabled) {
              gP.connect(previewSumGain);
            }
            idlePreviewPrimGainRef.current = gP;
          }
          if (want2 && ms2Node) {
            const gS = ctx.createGain();
            gS.gain.value = IDLE_PREVIEW_MIX_HEADROOM * sLin;
            ms2Node.connect(gS);
            gS.connect(previewSumGain);
            idlePreviewSecGainRef.current = gS;
          }
          if (want3 && ms3Node) {
            const gT = ctx.createGain();
            gT.gain.value = IDLE_PREVIEW_MIX_HEADROOM * tLin;
            ms3Node.connect(gT);
            gT.connect(previewSumGain);
            idlePreviewTertGainRef.current = gT;
          }
          idlePreviewMixStreamRef.current = previewMixDest.stream;
          setIdleInputGraphSeq((n) => n + 1);
        }
      } catch {
        safeCloseAudioContext(ctx);
        if (!cancelled) {
          setMicVu(0);
          setLineVu(0);
          setMediaVu(0);
          setMeterSampleRate(0);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      idlePreviewMixStreamRef.current = null;
      idlePreviewPrimGainRef.current = null;
      idlePreviewSecGainRef.current = null;
      idlePreviewTertGainRef.current = null;
      setIdleInputGraphSeq((n) => n + 1);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      safeCloseAudioContext(ctx);
      setMicVu(0);
      setLineVu(0);
      setMediaVu(0);
      micVuSmoothRef.current = 0;
      lineVuSmoothRef.current = 0;
      mediaVuSmoothRef.current = 0;
      setMeterSampleRate(0);
    };
  }, [idleInputGraphDepKey]);

  const idleMonitorEffectKey = useMemo(
    () =>
      [
        idleInputGraphSeq,
        pipelineMonitorEnabled,
        selectedOutputId,
        running,
        micTesting,
        outputTesting,
        captureStarting,
      ].join("\0"),
    [
      idleInputGraphSeq,
      pipelineMonitorEnabled,
      selectedOutputId,
      running,
      micTesting,
      outputTesting,
      captureStarting,
    ]
  );

  useEffect(() => {
    if (running || micTesting || outputTesting || captureStarting) {
      return;
    }
    let cancelled = false;
    let previewMeterCtx: AudioContext | null = null;
    let previewBranchDisconnect: (() => void) | null = null;

    const run = async () => {
      stopPipelineOutLevelLoop();
      previewBranchDisconnect?.();
      previewBranchDisconnect = null;
      safeCloseAudioContext(previewMeterCtx);
      previewMeterCtx = null;
      idlePreviewMonitorGainRef.current = null;
      pipelineOutputAnalyserRef.current = null;
      setPipelineBranchLive(false);

      const mixStream = idlePreviewMixStreamRef.current;
      if (
        !pipelineMonitorEnabled ||
        !selectedOutputId.trim() ||
        !mixStream
      ) {
        return;
      }

      try {
        previewMeterCtx = new AudioContext();
        await previewMeterCtx.resume();
        if (cancelled) {
          safeCloseAudioContext(previewMeterCtx);
          previewMeterCtx = null;
          return;
        }
        const prevSrc =
          previewMeterCtx.createMediaStreamSource(mixStream);
        const branch = await connectMonitorBranch(
          previewMeterCtx,
          prevSrc,
          {
            monitorGain: pipelineMonitorGainRef.current,
            outputDeviceId: selectedOutputId.trim(),
            inject: pipelineInjectRef.current,
          }
        );
        if (cancelled) {
          branch.disconnect();
          safeCloseAudioContext(previewMeterCtx);
          previewMeterCtx = null;
          return;
        }
        previewBranchDisconnect = branch.disconnect;
        idlePreviewMonitorGainRef.current = branch.gainNode;
        pipelineOutputAnalyserRef.current = branch.outputAnalyser;
        startPipelineOutLevelLoop();
        setPipelineBranchLive(true);
      } catch (e) {
        previewBranchDisconnect?.();
        previewBranchDisconnect = null;
        safeCloseAudioContext(previewMeterCtx);
        previewMeterCtx = null;
        idlePreviewMonitorGainRef.current = null;
        setPipelineBranchLive(false);
        const msg =
          e instanceof Error
            ? e.message
            : "Pré-visualização do monitor falhou";
        setError(msg);
      }
    };

    void run();

    return () => {
      cancelled = true;
      stopPipelineOutLevelLoop();
      previewBranchDisconnect?.();
      previewBranchDisconnect = null;
      safeCloseAudioContext(previewMeterCtx);
      previewMeterCtx = null;
      idlePreviewMonitorGainRef.current = null;
      setPipelineBranchLive(false);
    };
  }, [
    idleMonitorEffectKey,
    startPipelineOutLevelLoop,
    stopPipelineOutLevelLoop,
  ]);

  const selectClass =
    "panel-bezel h-10 w-full rounded-md bg-zinc-800 px-3 font-mono text-[12px] text-zinc-100 shadow-[inset_0_2px_8px_rgba(0,0,0,0.35)] outline-none ring-1 ring-zinc-600/50 transition focus:ring-2 focus:ring-amber-500/40 disabled:cursor-not-allowed disabled:opacity-45 sm:text-[13px]";

  const btnSecondary =
    "panel-bezel inline-flex min-h-[36px] min-w-[4.5rem] flex-1 items-center justify-center rounded-md bg-zinc-700 px-2 font-mono text-[10px] font-medium uppercase tracking-wide text-zinc-200 ring-1 ring-zinc-500/60 transition hover:bg-zinc-600 hover:ring-zinc-500 disabled:opacity-45 sm:min-h-[32px] sm:min-w-0 sm:flex-none sm:text-[11px]";

  const btnSky =
    "panel-bezel inline-flex min-h-[36px] w-full items-center justify-center rounded-md bg-sky-950/50 px-3 font-mono text-[10px] font-semibold uppercase tracking-wide text-sky-200 ring-1 ring-sky-800/45 transition hover:bg-sky-900/60 sm:min-h-[32px] sm:w-auto sm:text-[11px]";

  const navItemBase =
    "w-full shrink-0 rounded-md px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition sm:text-[11px] lg:min-w-0 lg:rounded-none lg:px-3";
  const navItemActive =
    "bg-zinc-800 text-amber-400 ring-1 ring-amber-600/35 lg:ring-0 lg:border-l-2 lg:border-amber-500 lg:bg-zinc-800/95";
  const navItemIdle =
    "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300 lg:hover:bg-zinc-800/40";

  const elevenLabsVoiceDisplayNameById = useMemo(() => {
    const m = new Map<string, string>();
    if (elevenLabsVoicesFromApi && elevenLabsVoicesFromApi.length > 0) {
      for (const vo of elevenLabsVoicesFromApi) {
        const id = vo.voice_id.trim();
        if (!id) {
          continue;
        }
        const nm = vo.name.trim() || id;
        m.set(id, nm);
        m.set(id.toLowerCase(), nm);
      }
    }
    return m;
  }, [elevenLabsVoicesFromApi]);

  const vocabularyVoicePrimaryLabel = useCallback(
    (voiceId: string) => {
      const raw = voiceId.trim();
      if (!raw) {
        return "Padrão (serviço)";
      }
      const fromLabels = labelForElevenLabsVoiceId(
        raw,
        elevenLabsVoiceDisplayBundle.voiceLabels
      );
      if (fromLabels) {
        return fromLabels;
      }
      const fromApi =
        elevenLabsVoiceDisplayNameById.get(raw) ??
        elevenLabsVoiceDisplayNameById.get(raw.toLowerCase());
      if (fromApi) {
        return fromApi;
      }
      const tail = raw.slice(-6);
      return tail ? `Voz · ${tail}` : "Voz";
    },
    [
      elevenLabsVoiceDisplayBundle.voiceLabels,
      elevenLabsVoiceDisplayNameById,
    ]
  );

  const elevenLabsVoiceSelectOptions = useMemo(() => {
    const labelWithGender = (base: string, sigla?: "H" | "F") => {
      const t = base.trim() || "Voz";
      return sigla === "H" || sigla === "F" ? `[${sigla}] ${t}` : t;
    };
    const bundle = elevenLabsVoiceDisplayBundle;
    let rows =
      elevenLabsVoicesFromApi && elevenLabsVoicesFromApi.length > 0
        ? elevenLabsVoicesFromApi.map((vo) => ({
            value: vo.voice_id,
            label: labelWithGender(
              vo.name || "",
              resolveElevenLabsGenderSigla(vo.voice_id, bundle, vo.genderSigla)
            ),
          }))
        : bundle.fallbackVoiceOptions.map((o) => ({
            value: o.value,
            label: labelWithGender(
              o.label,
              resolveElevenLabsGenderSigla(o.value, bundle, o.genderSigla)
            ),
          }));
    const sel = settings.selectedElevenLabsVoiceId.trim();
    if (sel && !rows.some((r) => r.value === sel)) {
      const lb = labelForElevenLabsVoiceId(
        sel,
        elevenLabsVoiceDisplayBundle.voiceLabels
      );
      const fbG = elevenLabsVoiceDisplayBundle.fallbackVoiceOptions.find(
        (o) => o.value === sel
      )?.genderSigla;
      const base = lb ? lb : "Outra voz";
      rows = [
        {
          value: sel,
          label: labelWithGender(
            base,
            resolveElevenLabsGenderSigla(sel, elevenLabsVoiceDisplayBundle, fbG)
          ),
        },
        ...rows,
      ];
    }
    return rows;
  }, [
    elevenLabsVoicesFromApi,
    settings.selectedElevenLabsVoiceId,
    elevenLabsVoiceDisplayBundle,
  ]);

  const elevenLabsVoiceSelectUiValue = useMemo(() => {
    const opts = elevenLabsVoiceSelectOptions;
    const cur = settings.selectedElevenLabsVoiceId.trim();
    if (opts.length === 0) {
      return cur;
    }
    return opts.some((o) => o.value === cur) ? cur : opts[0].value;
  }, [elevenLabsVoiceSelectOptions, settings.selectedElevenLabsVoiceId]);

  useEffect(() => {
    const opts = elevenLabsVoiceSelectOptions;
    if (opts.length === 0) {
      return;
    }
    const cur = settings.selectedElevenLabsVoiceId.trim();
    if (opts.some((o) => o.value === cur)) {
      return;
    }
    const pick = opts[0].value;
    setSettings((p) => ({ ...p, selectedElevenLabsVoiceId: pick }));
    saveEchoLinkSettingsToStorage({ selectedElevenLabsVoiceId: pick });
  }, [elevenLabsVoiceSelectOptions, settings.selectedElevenLabsVoiceId]);

  const navEntries: { id: SidebarSection; label: string }[] = [
    { id: "audioIn", label: "Controles" },
    { id: "monitor", label: "Monitoramento" },
    { id: "vocabulary", label: "Vocabulário" },
    { id: "chats", label: "Históricos" },
    { id: "info", label: "Informações" },
  ];

  const selectedOutputLabel =
    selectedOutputId &&
    (() => {
      const d = audioOutputs.find((x) => x.deviceId === selectedOutputId);
      return d
        ? formatMediaDeviceOptionLabel(
            d,
            "output",
            settings.outputDeviceAliases[d.deviceId]
          )
        : "";
    })();

  const pipelineTimelineMeta = useMemo(
    () => [
      { key: "capture", label: "Entrada", detail: "Microfone" },
      { key: "meter", label: "Medidor", detail: "AudioContext · VU" },
      { key: "ws", label: "Serviço", detail: "WebSocket · áudio" },
      {
        key: "stt",
        label: "Texto",
        detail: "Serviço Python (Transcribe / Vosk)",
      },
      { key: "pipe", label: "Saída pipeline", detail: "Monitor opcional" },
    ],
    []
  );

  const pipelineFirstIncompleteIndex = useMemo(() => {
    if (!running) return -1;
    const hasText = interimTranscript.trim().length > 0;
    const wsReadyForUtterance =
      serviceChunks > serviceChunksBaseline || hasText;
    const sttSkipped =
      !settings.speechLanguagesEnabled || serviceSttFailed;
    if (meterSampleRate <= 0) return 1;
    if (!connected) return 2;
    if (!wsReadyForUtterance) return 2;
    if (!sttSkipped && !hasText) return 3;
    if (pipelineMonitorEnabled && !pipelineBranchLive) return 4;
    return 5;
  }, [
    running,
    meterSampleRate,
    connected,
    serviceChunks,
    serviceChunksBaseline,
    interimTranscript,
    settings.speechLanguagesEnabled,
    serviceSttFailed,
    pipelineMonitorEnabled,
    pipelineBranchLive,
  ]);

  useEffect(() => {
    if (!running) {
      setPipelineVisibleDoneCount(0);
      return;
    }
    const target =
      pipelineFirstIncompleteIndex < 0 ? 0 : pipelineFirstIncompleteIndex;
    if (pipelineVisibleDoneCount >= target) return;
    const id = window.setTimeout(() => {
      setPipelineVisibleDoneCount((v) => Math.min(v + 1, target));
    }, 90);
    return () => window.clearTimeout(id);
  }, [
    running,
    pipelineFirstIncompleteIndex,
    pipelineVisibleDoneCount,
    pipelineUtteranceVersion,
  ]);

  const mixerStripOrderKey = settings.mixerStripOrder.join(",");
  const mixerStripOrderForUi = useMemo(
    () => sanitizeMixerStripOrder(settings.mixerStripOrder),
    [mixerStripOrderKey, settings.mixerStripOrder]
  );

  useEffect(() => {
    const normKey = mixerStripOrderForUi.join(",");
    if (mixerStripOrderKey === normKey) {
      return;
    }
    setSettings((prev) => ({
      ...prev,
      mixerStripOrder: mixerStripOrderForUi,
    }));
    saveEchoLinkSettingsToStorage({
      mixerStripOrder: mixerStripOrderForUi,
    });
  }, [mixerStripOrderKey, mixerStripOrderForUi]);

  const meterForLogDisplay = useMemo(() => {
    const combined = Math.max(micVu, lineVu, mediaVu);
    const sttMeter =
      settings.speechLanguagesEnabled &&
      serviceSttReady &&
      !serviceSttFailed;
    if (!running || !sttMeter) {
      return combined;
    }
    const aligned =
      interimTranscript.length > 0 ||
      transcriptLines.length > 0 ||
      combined >= METER_LOG_ALIGN_MIN;
    return aligned ? combined : combined * METER_LOG_IDLE_SCALE;
  }, [
    running,
    settings.speechLanguagesEnabled,
    serviceSttReady,
    serviceSttFailed,
    micVu,
    lineVu,
    mediaVu,
    interimTranscript,
    transcriptLines,
  ]);

  const audioOutDetailSections = (
                  <div className="grid grid-cols-1 gap-0 divide-y divide-zinc-600/35">
                    <section className="bg-zinc-900/50 p-3 sm:p-4">
                      <div className="mb-2.5 flex items-center gap-2 rounded-md bg-sky-950/25 px-2 py-1.5 ring-1 ring-sky-700/35">
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sky-300 sm:text-[10px] sm:tracking-[0.2em]">
                          Fones
                        </span>
                        <span className="text-[9px] text-zinc-400">
                          Monitor
                        </span>
                      </div>
                      <label
                        htmlFor="echo-output-device"
                        className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                      >
                        Saída
                      </label>
                      <select
                        id="echo-output-device"
                        className={selectClass}
                        disabled={busy}
                        value={selectedOutputId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSelectedOutputId(v);
                          setSettings((prev) => ({
                            ...prev,
                            selectedOutputDeviceId: v,
                          }));
                          saveEchoLinkSettingsToStorage({
                            selectedOutputDeviceId: v,
                          });
                        }}
                      >
                        <option value="">Principal / padrão</option>
                        {audioOutputs.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>
                            {formatMediaDeviceOptionLabel(
                              d,
                              "output",
                              settings.outputDeviceAliases[d.deviceId]
                            )}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 space-y-1 rounded-md border border-zinc-700/40 bg-zinc-950/35 px-2.5 py-2">
                        <p className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                          Configurações · números
                        </p>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[9px]">
                          <span className="text-zinc-500">Monitor entrada → saída</span>
                          <span className="text-right text-zinc-300">
                            {pipelineMonitorEnabled ? "Ligado" : "Desligado"}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[9px]">
                          <span className="text-zinc-500">Ganho do monitor</span>
                          <span className="tabular-nums text-zinc-300">
                            {Math.round(pipelineMonitorGain * 100)}%
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5 text-[9px]">
                          <span className="min-w-0 shrink text-zinc-500">
                            Saída alvo
                          </span>
                          <span className="max-w-[58%] truncate text-right text-zinc-300">
                            {selectedOutputId
                              ? selectedOutputLabel ||
                                `${selectedOutputId.slice(0, 12)}…`
                              : "Padrão do sistema"}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 sm:gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void refreshMediaDevices()}
                          className={btnSecondary}
                        >
                          Atualizar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void unlockMediaLabels()}
                          className={btnSecondary}
                        >
                          Nomes
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void testOutput()}
                          className={btnSky}
                        >
                          {outputTesting ? "…" : "Testar saída"}
                        </button>
                      </div>
                    </section>

                    <section className="bg-zinc-900/50 p-3 sm:p-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
                        Monitor local · pipeline
                      </p>
                      <p className="mb-3 text-[9px] leading-snug text-zinc-500">
                        Ouvir a entrada na saída pelo navegador (mesmo
                        AudioContext do medidor).
                      </p>
                      <p className="mb-3 rounded-md border border-amber-900/50 bg-amber-950/25 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200/95">
                        Use fones ou ganho baixo: monitor direto pode causar
                        microfonia.
                      </p>
                      <dl className="mb-4 grid grid-cols-1 gap-2 border-b border-zinc-700/40 pb-3 text-[10px] text-zinc-400">
                        <div className="flex justify-between gap-2">
                          <dt>Saída alvo</dt>
                          <dd className="max-w-[65%] truncate text-right text-zinc-300">
                            {selectedOutputId
                              ? selectedOutputLabel ||
                                selectedOutputId.slice(0, 14) + "…"
                              : "Padrão do sistema"}
                          </dd>
                        </div>
                      </dl>
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-amber-500"
                            checked={pipelineMonitorEnabled}
                            disabled={busy && !running}
                            onChange={(e) => {
                              const c = e.target.checked;
                              setPipelineMonitorEnabled(c);
                              setSettings((prev) => ({
                                ...prev,
                                pipelineMonitorEnabled: c,
                              }));
                              saveEchoLinkSettingsToStorage({
                                pipelineMonitorEnabled: c,
                              });
                            }}
                          />
                          Monitorar entrada → saída
                        </label>
                        <span className="text-[10px] text-zinc-500">
                          {running
                            ? pipelineMonitorEnabled
                              ? "Ativo no fluxo atual"
                              : "Desligado"
                            : pipelineMonitorEnabled
                              ? !selectedOutputId.trim()
                                ? "Escolha saída de áudio (fones)"
                                : pipelineBranchLive
                                  ? "Ativo sem captura"
                                  : "Ative um canal na mesa de entrada"
                              : "Desligado"}
                        </span>
                      </div>
                      <div>
                        <label
                          htmlFor="saida-pipeline-gain"
                          className="mb-1.5 block text-[9px] uppercase tracking-wider text-zinc-400"
                        >
                          Ganho do monitor (
                          {Math.round(pipelineMonitorGain * 100)}%)
                        </label>
                        <input
                          id="saida-pipeline-gain"
                          type="range"
                          min={1}
                          max={100}
                          disabled={
                            micTesting || outputTesting || captureStarting
                          }
                          value={Math.round(pipelineMonitorGain * 100)}
                          onChange={(e) => {
                            const pct = Number(e.target.value);
                            const gain = Math.max(0.01, pct / 100);
                            const rounded = Math.min(
                              100,
                              Math.max(1, Math.round(pct))
                            );
                            setPipelineMonitorGain(gain);
                            setSettings((prev) => ({
                              ...prev,
                              pipelineMonitorGainPercent: rounded,
                            }));
                            saveEchoLinkSettingsToStorage({
                              pipelineMonitorGainPercent: rounded,
                            });
                          }}
                          className="echo-range h-6 w-full max-w-md cursor-pointer disabled:opacity-45"
                          style={
                            {
                              "--range-progress": timingRangeProgress(
                                Math.round(pipelineMonitorGain * 100),
                                1,
                                100
                              ),
                            } as CSSProperties
                          }
                        />
                      </div>
                    </section>
                  </div>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-900 font-mono">
        <header className="shrink-0 border-b border-zinc-800 bg-zinc-900">
          <div className="flex flex-col gap-3 px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-500/45 bg-zinc-800 text-[9px] font-bold text-amber-300 shadow-inner sm:h-9 sm:w-9 sm:text-[10px]"
                aria-hidden
              >
                EL
              </div>
              <div className="min-w-0">
                <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-400 sm:text-[11px] sm:tracking-[0.2em]">
                  EchoLink
                </p>
                <p className="truncate font-mono text-[9px] text-zinc-500 sm:text-[10px]">
                  Painel · E/S local · WebSocket
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3 lg:ml-auto">
              <code className="max-w-[min(100%,14rem)] truncate rounded-md bg-zinc-800 px-2 py-1 text-[9px] text-emerald-300 shadow-inner ring-1 ring-zinc-600/40 sm:text-[10px]">
                {echoLinkServiceOriginForDisplay()}
              </code>
              {!running ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSidebarSection("monitor");
                    saveEchoLinkSettingsToStorage({ sidebarSection: "monitor" });
                    void start();
                  }}
                  className="panel-bezel inline-flex h-10 min-w-32 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-emerald-600 to-emerald-800 px-5 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-[0_3px_0_rgba(6,78,59,0.85)] ring-1 ring-emerald-500/35 transition hover:brightness-110 active:translate-y-px active:shadow-none disabled:opacity-45 sm:h-11 sm:min-w-36 sm:px-6 sm:text-xs"
                >
                  Iniciar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopAll}
                  className="panel-bezel inline-flex h-10 min-w-32 shrink-0 items-center justify-center rounded-full bg-linear-to-b from-zinc-700 to-zinc-800 px-5 text-[11px] font-bold uppercase tracking-[0.18em] text-red-200 shadow-[0_3px_0_rgba(0,0,0,0.45)] ring-1 ring-red-900/45 transition hover:brightness-110 active:translate-y-px sm:h-11 sm:min-w-36 sm:px-6 sm:text-xs"
                >
                  Parar
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="relative isolate flex min-h-0 flex-1 flex-col bg-zinc-900 lg:flex-row lg:items-stretch">
            <nav
              className="app-region-no-drag pointer-events-auto relative z-50 flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900 p-2 lg:h-full lg:min-h-0 lg:w-52 lg:max-w-52 lg:flex-col lg:justify-start lg:gap-0 lg:overflow-x-hidden lg:overflow-y-auto lg:self-stretch lg:border-b-0 lg:border-r lg:bg-zinc-950/40 lg:p-0 lg:py-2"
              aria-label="Navegação do painel"
            >
              {navEntries.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSidebarSection(item.id);
                    saveEchoLinkSettingsToStorage({
                      sidebarSection: item.id,
                    });
                  }}
                  className={`app-region-no-drag ${navItemBase} min-w-30 touch-manipulation lg:min-w-0 lg:w-full ${sidebarSection === item.id ? navItemActive : navItemIdle}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-900">
              {sidebarSection === "audioIn" ? (
                audioInLayoutMode === "mixer" ? (
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col divide-y divide-zinc-600/35">
                    <div className="shrink-0 border-b border-zinc-600/35 bg-zinc-900/60 px-3 py-2 sm:px-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Canais de entrada
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-400">
                        Mesa de som · faders e VU. O traço no topo de cada faixa
                        serve para arrastar e mudar a ordem (fica gravado nas
                        definições). Em cada canal, Editar abre dispositivos,
                        tempos de captura e teste do microfone.
                      </p>
                    </div>
                    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-linear-to-b from-[#0c0c0e] via-[#080809] to-black">
                      <div
                        className={`flex min-h-0 min-w-0 flex-1 flex-row ${mixerSideEditor ? "pointer-events-none invisible" : ""}`}
                        aria-hidden={mixerSideEditor ? true : undefined}
                      >
                        <div className="flex min-h-0 shrink-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
                          <div className="flex min-h-0 min-w-0 flex-1 items-stretch justify-start gap-3 overflow-x-auto pb-1 sm:gap-5">
                            {mixerStripOrderForUi.map(
                              (stripSlot, stackIndex) => {
                                const stripDnD: MixerStripDnDProps = {
                                  mixerStripId: stripSlot,
                                  stripStackIndex: stackIndex,
                                  draggingMixerStripId,
                                  onMixerStripDragStart:
                                    handleMixerStripDragStart,
                                  onMixerStripDragEnd: handleMixerStripDragEnd,
                                  onMixerStripDragOver:
                                    handleMixerStripDragOver,
                                  onMixerStripDrop: handleMixerStripDrop,
                                };
                                if (stripSlot === "ch1") {
                                  return (
                                    <MixerConsoleInputChannel
                                      key={stripSlot}
                                      channelId={1}
                                      activateOn={mixerActivate1}
                                      onActivateToggle={() => {
                                        setMixerActivate1((v) => {
                                          const next = !v;
                                          if (!next) {
                                            setMixerMute1(true);
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel1Active: next,
                                              mixerChannel1Muted: true,
                                            });
                                          } else {
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel1Active: next,
                                            });
                                          }
                                          return next;
                                        });
                                      }}
                                      onEdit={() => {
                                        setMixerSideEditor("microphone");
                                        setAudioInDetailScope("microphone");
                                        setAudioInChannelTab("microphone");
                                        saveEchoLinkSettingsToStorage({
                                          audioInDetailScope: "microphone",
                                          audioInChannelTab: "microphone",
                                        });
                                      }}
                                      muted={mixerMute1}
                                      onMuteToggle={() => {
                                        setMixerMute1((v) => {
                                          const next = !v;
                                          saveEchoLinkSettingsToStorage({
                                            mixerChannel1Muted: next,
                                          });
                                          return next;
                                        });
                                      }}
                                      deviceLabel={
                                        selectedInputId
                                          ? (() => {
                                              const d = audioInputs.find(
                                                (x) =>
                                                  x.deviceId ===
                                                  selectedInputId
                                              );
                                              return d
                                                ? formatMediaDeviceOptionLabel(
                                                    d,
                                                    "input",
                                                    settings
                                                      .inputDeviceAliases[
                                                      d.deviceId
                                                    ]
                                                  )
                                                : "…";
                                            })()
                                          : "Mic · padrão"
                                      }
                                      vuLevel={micVu}
                                      faderValue={
                                        settings.primaryChannelMixGainPercent
                                      }
                                      onFaderChange={(v) =>
                                        setMixerChannelMixGainPercent(1, v)
                                      }
                                      faderDisabled={false}
                                      busy={busy}
                                      {...stripDnD}
                                    />
                                  );
                                }
                                if (stripSlot === "ch2") {
                                  return (
                                    <MixerConsoleInputChannel
                                      key={stripSlot}
                                      channelId={2}
                                      activateOn={mixerActivate2}
                                      onActivateToggle={() => {
                                        setMixerActivate2((v) => {
                                          const next = !v;
                                          if (!next) {
                                            setMixerMute2(true);
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel2Active: next,
                                              mixerChannel2Muted: true,
                                            });
                                          } else {
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel2Active: next,
                                            });
                                          }
                                          return next;
                                        });
                                      }}
                                      onEdit={() => {
                                        setMixerSideEditor("systemAudio");
                                        setAudioInDetailScope("systemAudio");
                                        setAudioInChannelTab("systemAudio");
                                        saveEchoLinkSettingsToStorage({
                                          audioInDetailScope: "systemAudio",
                                          audioInChannelTab: "systemAudio",
                                        });
                                      }}
                                      muted={mixerMute2}
                                      onMuteToggle={() => {
                                        setMixerMute2((v) => {
                                          const next = !v;
                                          saveEchoLinkSettingsToStorage({
                                            mixerChannel2Muted: next,
                                          });
                                          return next;
                                        });
                                      }}
                                      deviceLabel={
                                        selectedSecondaryInputId &&
                                        selectedSecondaryInputId !==
                                          selectedInputId
                                          ? (() => {
                                              const d = audioInputs.find(
                                                (x) =>
                                                  x.deviceId ===
                                                  selectedSecondaryInputId
                                              );
                                              return d
                                                ? formatMediaDeviceOptionLabel(
                                                    d,
                                                    "input",
                                                    settings
                                                      .inputDeviceAliases[
                                                      d.deviceId
                                                    ]
                                                  )
                                                : "…";
                                            })()
                                          : "Teams · off"
                                      }
                                      vuLevel={lineVu}
                                      faderValue={
                                        settings.secondaryChannelMixGainPercent
                                      }
                                      onFaderChange={(v) =>
                                        setMixerChannelMixGainPercent(2, v)
                                      }
                                      faderDisabled={
                                        !selectedSecondaryInputId ||
                                        selectedSecondaryInputId ===
                                          selectedInputId
                                      }
                                      busy={busy}
                                      {...stripDnD}
                                    />
                                  );
                                }
                                if (stripSlot === "ch3") {
                                  return (
                                    <MixerConsoleInputChannel
                                      key={stripSlot}
                                      channelId={3}
                                      activateOn={mixerActivate3}
                                      onActivateToggle={() => {
                                        setMixerActivate3((v) => {
                                          const next = !v;
                                          if (!next) {
                                            setMixerMute3(true);
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel3Active: next,
                                              mixerChannel3Muted: true,
                                            });
                                          } else {
                                            saveEchoLinkSettingsToStorage({
                                              mixerChannel3Active: next,
                                            });
                                          }
                                          return next;
                                        });
                                      }}
                                      onEdit={() => {
                                        setMixerSideEditor("media");
                                        setAudioInDetailScope("media");
                                        setAudioInChannelTab("media");
                                        saveEchoLinkSettingsToStorage({
                                          audioInDetailScope: "media",
                                          audioInChannelTab: "media",
                                        });
                                      }}
                                      muted={mixerMute3}
                                      onMuteToggle={() => {
                                        setMixerMute3((v) => {
                                          const next = !v;
                                          saveEchoLinkSettingsToStorage({
                                            mixerChannel3Muted: next,
                                          });
                                          return next;
                                        });
                                      }}
                                      deviceLabel={
                                        selectedTertiaryInputId &&
                                        selectedTertiaryInputId !==
                                          selectedInputId &&
                                        selectedTertiaryInputId !==
                                          selectedSecondaryInputId
                                          ? (() => {
                                              const d = audioInputs.find(
                                                (x) =>
                                                  x.deviceId ===
                                                  selectedTertiaryInputId
                                              );
                                              return d
                                                ? formatMediaDeviceOptionLabel(
                                                    d,
                                                    "input",
                                                    settings
                                                      .inputDeviceAliases[
                                                      d.deviceId
                                                    ]
                                                  )
                                                : "…";
                                            })()
                                          : "MÍDIA · off"
                                      }
                                      vuLevel={mediaVu}
                                      faderValue={
                                        settings.tertiaryChannelMixGainPercent
                                      }
                                      onFaderChange={(v) =>
                                        setMixerChannelMixGainPercent(3, v)
                                      }
                                      faderDisabled={
                                        !selectedTertiaryInputId ||
                                        selectedTertiaryInputId ===
                                          selectedInputId ||
                                        selectedTertiaryInputId ===
                                          selectedSecondaryInputId
                                      }
                                      busy={busy}
                                      {...stripDnD}
                                    />
                                  );
                                }
                                return (
                                  <MixerConsoleOutputChannel
                                    key={stripSlot}
                                    activateOn={pipelineMonitorEnabled}
                                    onActivateToggle={() => {
                                      setPipelineMonitorEnabled((prev) => {
                                        const next = !prev;
                                        setSettings((p) => ({
                                          ...p,
                                          pipelineMonitorEnabled: next,
                                        }));
                                        saveEchoLinkSettingsToStorage({
                                          pipelineMonitorEnabled: next,
                                        });
                                        return next;
                                      });
                                    }}
                                    onEdit={() => {
                                      setMixerSideEditor("output");
                                    }}
                                    muted={mixerOutputMute}
                                    onMuteToggle={() => {
                                      setMixerOutputMute((v) => {
                                        const next = !v;
                                        saveEchoLinkSettingsToStorage({
                                          mixerOutputMuted: next,
                                        });
                                        return next;
                                      });
                                    }}
                                    deviceLabel={
                                      selectedOutputId.trim()
                                        ? selectedOutputLabel ||
                                          `${selectedOutputId.slice(0, 14)}…`
                                        : "Saída · padrão"
                                    }
                                    vuLevel={pipelineOutVu}
                                    faderValue={
                                      settings.outputChannelMixGainPercent
                                    }
                                    onFaderChange={(v) =>
                                      setMixerChannelMixGainPercent(4, v)
                                    }
                                    faderDisabled={!selectedOutputId.trim()}
                                    busy={busy}
                                    activateDisabled={busy && !running}
                                    {...stripDnD}
                                  />
                                );
                              }
                            )}
                          </div>
                        </div>
                        <div
                          className="min-h-0 min-w-0 flex-1 bg-black"
                          aria-hidden
                        />
                      </div>
                      {mixerSideEditor ? (
                        <div className="absolute inset-0 z-10 flex min-h-0 min-w-0 flex-col bg-zinc-950/98 ring-1 ring-zinc-700/60">
                          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-700/50 bg-zinc-950/90 px-3 py-2 sm:px-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-300 sm:text-[11px]">
                              {mixerSideEditor === "microphone"
                                ? "Canal 1 · microfone"
                                : mixerSideEditor === "systemAudio"
                                  ? "Canal 2 · linha"
                                  : mixerSideEditor === "media"
                                    ? "Canal 3 · mídia"
                                    : "Saída de áudio"}
                            </p>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void refreshMediaDevices()}
                                className={btnSecondary}
                              >
                                Atualizar
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void unlockMediaLabels()}
                                className={btnSecondary}
                              >
                                Nomes
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setMixerSideEditor(null)}
                                className="panel-bezel inline-flex min-h-9 items-center justify-center rounded-md bg-zinc-800 px-3 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-200 ring-1 ring-zinc-600/50 transition hover:bg-zinc-700 sm:min-h-8 sm:text-[11px]"
                              >
                                Fechar
                              </button>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto">
                            {mixerSideEditor === "microphone" ? (
                              <AudioInMicInputDetailPanel
                                embedded
                                audioInDetailScope="microphone"
                                settings={settings}
                                setSettings={setSettings}
                                selectedInputId={selectedInputId}
                                setSelectedInputId={setSelectedInputId}
                                selectedSecondaryInputId={
                                  selectedSecondaryInputId
                                }
                                selectedTertiaryInputId={selectedTertiaryInputId}
                                setSelectedSecondaryInputId={
                                  setSelectedSecondaryInputId
                                }
                                setSelectedTertiaryInputId={
                                  setSelectedTertiaryInputId
                                }
                                audioInputs={audioInputs}
                                busy={busy}
                                micTesting={micTesting}
                                outputTesting={outputTesting}
                                meterSampleRate={meterSampleRate}
                                selectClass={selectClass}
                                btnSky={btnSky}
                                setSettingsField={setSettingsField}
                                testMicrophone={testMicrophone}
                                elevenLabsVoiceSelectOptions={
                                  elevenLabsVoiceSelectOptions
                                }
                                elevenLabsVoiceSelectUiValue={
                                  elevenLabsVoiceSelectUiValue
                                }
                                elevenLabsVoicesLoading={
                                  elevenLabsVoicesLoading
                                }
                                voiceTranslationEnabled={
                                  voiceTranslationEnabled
                                }
                                setVoiceTranslationEnabled={
                                  setVoiceTranslationEnabled
                                }
                                voiceTranslationBackendStatus={
                                  voiceTranslationBackendStatus
                                }
                              />
                            ) : mixerSideEditor === "systemAudio" ? (
                              <AudioInLineInputDetailPanel
                                embedded
                                audioInDetailScope="systemAudio"
                                settings={settings}
                                setSettings={setSettings}
                                selectedInputId={selectedInputId}
                                selectedSecondaryInputId={
                                  selectedSecondaryInputId
                                }
                                selectedTertiaryInputId={selectedTertiaryInputId}
                                setSelectedSecondaryInputId={
                                  setSelectedSecondaryInputId
                                }
                                setSelectedTertiaryInputId={
                                  setSelectedTertiaryInputId
                                }
                                audioInputs={audioInputs}
                                busy={busy}
                                selectClass={selectClass}
                                previewVuLevel={lineVu}
                              />
                            ) : mixerSideEditor === "media" ? (
                              <AudioInMediaInputDetailPanel
                                embedded
                                audioInDetailScope="media"
                                settings={settings}
                                setSettings={setSettings}
                                selectedInputId={selectedInputId}
                                selectedSecondaryInputId={
                                  selectedSecondaryInputId
                                }
                                selectedTertiaryInputId={selectedTertiaryInputId}
                                setSelectedTertiaryInputId={
                                  setSelectedTertiaryInputId
                                }
                                audioInputs={audioInputs}
                                busy={busy}
                                selectClass={selectClass}
                                previewVuLevel={mediaVu}
                              />
                            ) : (
                              audioOutDetailSections
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-600/35">
                    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-600/35 bg-zinc-950/60 px-3 py-2 sm:px-4">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setAudioInLayoutMode("mixer");
                          setAudioInDetailScope("both");
                          setMixerSideEditor(null);
                          saveEchoLinkSettingsToStorage({
                            audioInLayoutMode: "mixer",
                            audioInDetailScope: "both",
                          });
                        }}
                        className="panel-bezel inline-flex min-h-9 items-center justify-center rounded-md bg-zinc-800 px-3 font-mono text-[10px] font-bold uppercase tracking-wide text-zinc-200 ring-1 ring-zinc-600/50 transition hover:bg-zinc-700 sm:min-h-8 sm:text-[11px]"
                      >
                        Voltar à mesa
                      </button>
                    </div>
                    <div className="border-b border-zinc-600/35 bg-zinc-900/60 px-3 py-2 sm:px-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Canais de entrada
                      </p>
                      {audioInDetailScope === "both" ? (
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Cada separador é um canal de entrada. O medidor VU, os
                          tempos de bloco, idioma/tradução e voz ElevenLabs
                          (nuvem) ficam no canal 1 (microfone). Os canais ativos
                          (até três entradas) são misturados antes do STT e do
                          envio ao serviço.
                        </p>
                      ) : audioInDetailScope === "microphone" ? (
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Definições só do microfone (canal 1): dispositivo, nível
                          na mesa, VU, tempos de captura, idioma/tradução, voz
                          ElevenLabs (nuvem) e teste do mic.
                        </p>
                      ) : audioInDetailScope === "systemAudio" ? (
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Definições da entrada adicional (canal 2): dispositivo,
                          medidor em tempo real e nível na mesa. Tempos de bloco
                          seguem o canal 1.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Definições da entrada mídia (canal 3): dispositivo,
                          medidor em tempo real e nível na mesa. Tempos de bloco
                          seguem o canal 1.
                        </p>
                      )}
                      <p className="mt-2 text-[9px] leading-snug text-zinc-500">
                        Os nomes vêm do navegador e podem diferir do sistema. O
                        sufixo após “·” identifica o dispositivo na Web.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 border-b border-zinc-600/35 bg-zinc-900/40 px-3 py-2 sm:px-4">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void refreshMediaDevices()}
                        className={btnSecondary}
                      >
                        Atualizar
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void unlockMediaLabels()}
                        className={btnSecondary}
                      >
                        Nomes
                      </button>
                    </div>
                  {audioInDetailScope === "both" ? (
                    <div
                      className="border-b border-zinc-600/35 bg-zinc-950/30 px-3 py-2 sm:px-4"
                      role="tablist"
                      aria-label="Canais de entrada"
                    >
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={audioInChannelTab === "microphone"}
                          id="audio-in-tab-mic"
                          className={`panel-bezel rounded-md px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition sm:text-[11px] ${
                            audioInChannelTab === "microphone"
                              ? "bg-zinc-800 text-amber-400 ring-1 ring-amber-600/35"
                              : "text-zinc-500 ring-1 ring-transparent hover:bg-zinc-800/50 hover:text-zinc-300"
                          }`}
                          onClick={() => {
                            setAudioInChannelTab("microphone");
                            saveEchoLinkSettingsToStorage({
                              audioInChannelTab: "microphone",
                            });
                          }}
                        >
                          Canal 1 · microfone
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={audioInChannelTab === "systemAudio"}
                          id="audio-in-tab-audio"
                          className={`panel-bezel rounded-md px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition sm:text-[11px] ${
                            audioInChannelTab === "systemAudio"
                              ? "bg-zinc-800 text-amber-400 ring-1 ring-amber-600/35"
                              : "text-zinc-500 ring-1 ring-transparent hover:bg-zinc-800/50 hover:text-zinc-300"
                          }`}
                          onClick={() => {
                            setAudioInChannelTab("systemAudio");
                            saveEchoLinkSettingsToStorage({
                              audioInChannelTab: "systemAudio",
                            });
                          }}
                        >
                          Canal 2 · áudio
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={audioInChannelTab === "media"}
                          id="audio-in-tab-media"
                          className={`panel-bezel rounded-md px-3 py-2 text-left text-[10px] font-bold uppercase tracking-[0.12em] transition sm:text-[11px] ${
                            audioInChannelTab === "media"
                              ? "bg-zinc-800 text-amber-400 ring-1 ring-amber-600/35"
                              : "text-zinc-500 ring-1 ring-transparent hover:bg-zinc-800/50 hover:text-zinc-300"
                          }`}
                          onClick={() => {
                            setAudioInChannelTab("media");
                            saveEchoLinkSettingsToStorage({
                              audioInChannelTab: "media",
                            });
                          }}
                        >
                          Canal 3 · mídia
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-0 divide-y divide-zinc-600/35">
                    {audioInActivePanel === "microphone" ? (
                      <AudioInMicInputDetailPanel
                        embedded={false}
                        audioInDetailScope={audioInDetailScope}
                        settings={settings}
                        setSettings={setSettings}
                        selectedInputId={selectedInputId}
                        setSelectedInputId={setSelectedInputId}
                        selectedSecondaryInputId={selectedSecondaryInputId}
                        selectedTertiaryInputId={selectedTertiaryInputId}
                        setSelectedSecondaryInputId={setSelectedSecondaryInputId}
                        setSelectedTertiaryInputId={setSelectedTertiaryInputId}
                        audioInputs={audioInputs}
                        busy={busy}
                        micTesting={micTesting}
                        outputTesting={outputTesting}
                        meterSampleRate={meterSampleRate}
                        selectClass={selectClass}
                        btnSky={btnSky}
                        setSettingsField={setSettingsField}
                        testMicrophone={testMicrophone}
                        elevenLabsVoiceSelectOptions={
                          elevenLabsVoiceSelectOptions
                        }
                        elevenLabsVoiceSelectUiValue={
                          elevenLabsVoiceSelectUiValue
                        }
                        elevenLabsVoicesLoading={elevenLabsVoicesLoading}
                        voiceTranslationEnabled={voiceTranslationEnabled}
                        setVoiceTranslationEnabled={
                          setVoiceTranslationEnabled
                        }
                        voiceTranslationBackendStatus={
                          voiceTranslationBackendStatus
                        }
                      />
                    ) : audioInActivePanel === "systemAudio" ? (
                      <AudioInLineInputDetailPanel
                        embedded={false}
                        audioInDetailScope={audioInDetailScope}
                        settings={settings}
                        setSettings={setSettings}
                        selectedInputId={selectedInputId}
                        selectedSecondaryInputId={selectedSecondaryInputId}
                        selectedTertiaryInputId={selectedTertiaryInputId}
                        setSelectedSecondaryInputId={setSelectedSecondaryInputId}
                        setSelectedTertiaryInputId={setSelectedTertiaryInputId}
                        audioInputs={audioInputs}
                        busy={busy}
                        selectClass={selectClass}
                        previewVuLevel={lineVu}
                      />
                    ) : (
                      <AudioInMediaInputDetailPanel
                        embedded={false}
                        audioInDetailScope={audioInDetailScope}
                        settings={settings}
                        setSettings={setSettings}
                        selectedInputId={selectedInputId}
                        selectedSecondaryInputId={selectedSecondaryInputId}
                        selectedTertiaryInputId={selectedTertiaryInputId}
                        setSelectedTertiaryInputId={setSelectedTertiaryInputId}
                        audioInputs={audioInputs}
                        busy={busy}
                        selectClass={selectClass}
                        previewVuLevel={mediaVu}
                      />
                    )}
                  </div>
                </div>
                )
              ) : sidebarSection === "monitor" ? (
                <div className="flex min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
                  <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-zinc-600/35 pb-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Monitoramento
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                        Etapas · medidores · chat · ajustes finos em Controles
                        (mesa e configurações da faixa Saída)
                        {settings.speechLanguagesEnabled &&
                        settings.speechReceiveLanguage !==
                          settings.speechTransformLanguage ? (
                          <span className="text-zinc-500">
                            {" "}
                            · fala{" "}
                            {settings.speechReceiveLanguage.slice(0, 2).toUpperCase()}{" "}
                            → texto{" "}
                            {settings.speechTransformLanguage
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {!chatPanelExpanded ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setChatPanelExpanded(true)}
                          className="shrink-0 text-[11px] uppercase tracking-wide text-zinc-400 transition hover:text-emerald-400 disabled:opacity-45"
                        >
                          Expandir chat
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setTranscriptLines([]);
                          transcriptLineIdRef.current = 0;
                          setInterimTranscript("");
                          bumpPipelineUtterance();
                          const sid = captureChatSessionIdRef.current;
                          if (sid && running) {
                            void putEchoLinkChatSessionSnapshot(sid, {
                              messages: [],
                              interimPt: null,
                              ended: false,
                            });
                          }
                        }}
                        className="shrink-0 text-[11px] uppercase tracking-wide text-zinc-400 transition hover:text-amber-400 disabled:opacity-45"
                      >
                        Limpar chat
                      </button>
                    </div>
                  </div>

                  <div className="flex min-h-[min(52vh,28rem)] min-w-0 flex-1 flex-col gap-5 lg:flex-row lg:items-stretch lg:gap-6">
                    <aside
                      className="shrink-0 lg:w-52 lg:max-w-52 lg:border-r lg:border-zinc-800 lg:pr-6"
                      aria-label="Etapas da pipeline"
                    >
                      <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                        Pipeline
                      </p>
                      <ol className="flex flex-col">
                        {pipelineTimelineMeta.map((step, idx) => {
                          const fi = pipelineFirstIncompleteIndex;
                          const capVd =
                            fi < 0
                              ? 0
                              : Math.min(pipelineVisibleDoneCount, fi);
                          const isDone = fi >= 0 && idx < capVd;
                          const isActive =
                            fi >= 0 && idx === capVd && capVd < 5;
                          return (
                            <li key={step.key} className="flex gap-2.5">
                              <div className="flex w-4 shrink-0 flex-col items-center pt-0.5">
                                <span
                                  className={`relative z-10 h-2.5 w-2.5 shrink-0 rounded-full border-2 transition-colors ${
                                    isDone
                                      ? "border-emerald-500 bg-emerald-500"
                                      : isActive
                                        ? "border-amber-400 bg-amber-500/40 shadow-[0_0_10px_rgba(251,191,36,0.45)]"
                                        : "border-zinc-600 bg-zinc-800"
                                  }`}
                                  aria-hidden
                                />
                                {idx < pipelineTimelineMeta.length - 1 ? (
                                  <span
                                    className={`min-h-[1.35rem] w-px flex-1 ${
                                      isDone
                                        ? "bg-emerald-700/80"
                                        : "bg-zinc-700"
                                    }`}
                                    aria-hidden
                                  />
                                ) : null}
                              </div>
                              <div
                                className={`min-w-0 flex-1 pb-3 ${idx === pipelineTimelineMeta.length - 1 ? "pb-0" : ""}`}
                              >
                                <p
                                  className={`text-[10px] font-semibold leading-tight ${
                                    isDone
                                      ? "text-emerald-300"
                                      : isActive
                                        ? "text-amber-300"
                                        : "text-zinc-500"
                                  }`}
                                >
                                  {step.label}
                                </p>
                                <p className="text-[9px] leading-snug text-zinc-500">
                                  {step.detail}
                                </p>
                                <p
                                  className={`mt-0.5 text-[9px] uppercase tracking-wider ${
                                    isDone
                                      ? "text-emerald-600/90"
                                      : isActive
                                        ? "text-amber-500/90"
                                        : "text-zinc-600"
                                  }`}
                                >
                                  {isDone
                                    ? "Passou"
                                    : isActive
                                      ? "Aqui"
                                      : "Aguardando"}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </aside>

                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
                      <div className="overflow-hidden rounded-md border border-zinc-600/35 bg-zinc-900/50 sm:rounded-lg">
                        <div className="grid grid-cols-1 divide-y divide-zinc-600/35 sm:grid-cols-2 sm:divide-x sm:divide-y-0 sm:items-stretch">
                          <section className="flex min-h-0 flex-col p-3">
                            <p className="mb-2 flex min-h-[2.5rem] items-end text-[9px] font-bold uppercase leading-snug tracking-[0.24em] text-zinc-400 sm:text-[10px]">
                              Medidor de entrada
                            </p>
                            <div className="mb-2 flex min-h-[1.25rem] items-center justify-between gap-2 text-[10px] text-zinc-400 sm:text-[11px]">
                              <span className="shrink-0">Mic / nível</span>
                              <span className="tabular-nums text-zinc-500">
                                {Math.round(
                                  Math.min(1, Math.max(0, meterForLogDisplay)) * 100
                                )}
                                %
                              </span>
                            </div>
                            <div className="panel-bezel h-7 w-full shrink-0 overflow-hidden rounded-md bg-zinc-950 ring-1 ring-zinc-600/50">
                              <div
                                className="h-full bg-linear-to-r from-emerald-600 via-amber-400 to-red-500 transition-[width] duration-75 ease-out"
                                style={{
                                  width: `${Math.round(Math.min(1, Math.max(0, meterForLogDisplay)) * 100)}%`,
                                }}
                              />
                            </div>
                            <p className="mt-2 text-[9px] leading-snug text-zinc-600">
                              Ajustes de sensibilidade e tempo estão em Entrada
                              de áudio.
                            </p>
                          </section>

                          <section className="flex min-h-0 flex-col p-3">
                            <p className="mb-2 flex min-h-[2.5rem] items-end text-[9px] font-bold uppercase leading-snug tracking-[0.24em] text-zinc-400 sm:text-[10px]">
                              Saída (pipeline)
                            </p>
                            <div className="mb-2 flex min-h-[1.25rem] items-center justify-between gap-2 text-[10px] text-zinc-400 sm:text-[11px]">
                              <span className="shrink-0">USB / WS</span>
                              <span
                                className={
                                  connected
                                    ? "shrink-0 font-bold text-emerald-400"
                                    : "shrink-0 text-zinc-500"
                                }
                              >
                                {connected ? "Ativo" : "Pronto"}
                              </span>
                            </div>
                            <div className="panel-bezel h-7 w-full shrink-0 overflow-hidden rounded-md bg-zinc-950 ring-1 ring-zinc-600/50">
                              <div
                                className="h-full bg-linear-to-r from-sky-700 via-cyan-400 to-emerald-500 transition-[width] duration-75 ease-out"
                                style={{
                                  width: `${Math.round(rxLevel * 100)}%`,
                                }}
                              />
                            </div>
                            <p className="mt-2 text-[9px] leading-snug text-zinc-600">
                              Monitor local e ganho: Controles · engrenagem na
                              faixa Saída.
                            </p>
                          </section>
                        </div>
                        <div className="grid grid-cols-1 border-t border-zinc-600/35 sm:grid-cols-2 sm:divide-x sm:divide-zinc-600/35">
                          <div className="flex min-h-[2.5rem] flex-col justify-center gap-0.5 px-3 py-2.5">
                            <span className="text-[10px] tabular-nums text-zinc-500 sm:text-[11px]">
                              Entrada · bloco {settings.audioChunkMs} ms
                            </span>
                            <span className="text-[9px] tabular-nums text-zinc-600">
                              Sensibilidade {settings.inputSensitivity}% · Corte
                              visor {settings.phraseSilenceCutMs} ms
                            </span>
                          </div>
                          <div className="flex min-h-[2.5rem] items-center justify-end px-3 py-2.5 text-right">
                            <p className="text-[10px] tabular-nums text-zinc-400 sm:text-[11px]">
                              {serviceChunks} pacotes ·{" "}
                              {serviceBytes.toLocaleString("pt-BR")} B
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-md border border-zinc-600/35 bg-zinc-900/40 sm:rounded-lg">
                        <div className="border-b border-zinc-600/35 px-3 py-2.5 sm:px-4">
                          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                            Áudio · pipeline no navegador
                          </p>
                          <p className="mt-1 text-[9px] leading-snug text-zinc-500">
                            Níveis pré/pós pipeline. Monitor e ganho em Controles
                            (faixa Saída). Injeção opcional via{" "}
                            <span className="font-mono text-zinc-500">
                              audioPipelineInject
                            </span>
                            .
                          </p>
                        </div>
                        <div className="p-3 sm:p-4">
                          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                                Entrada (pré-pipeline)
                              </p>
                              <div className="panel-bezel h-7 overflow-hidden rounded-md bg-zinc-950 ring-1 ring-zinc-600/50">
                                <div
                                  className="h-full bg-linear-to-r from-emerald-700 via-lime-400 to-amber-400 transition-[width] duration-75 ease-out"
                                  style={{
                                    width: `${Math.round(Math.min(1, Math.max(0, meterForLogDisplay)) * 100)}%`,
                                  }}
                                />
                              </div>
                              <p className="mt-1 text-[10px] tabular-nums text-zinc-500">
                                {Math.round(
                                  Math.min(1, Math.max(0, meterForLogDisplay)) *
                                    100
                                )}
                                %
                              </p>
                            </div>
                            <div>
                              <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                                Após pipeline (saída)
                              </p>
                              <div className="panel-bezel h-7 overflow-hidden rounded-md bg-zinc-950 ring-1 ring-zinc-600/50">
                                <div
                                  className="h-full bg-linear-to-r from-violet-800 via-fuchsia-400 to-amber-300 transition-[width] duration-75 ease-out"
                                  style={{
                                    width: `${Math.round(Math.min(1, Math.max(0, pipelineOutVu)) * 100)}%`,
                                  }}
                                />
                              </div>
                              <p className="mt-1 text-[10px] tabular-nums text-zinc-500">
                                {Math.round(
                                  Math.min(1, Math.max(0, pipelineOutVu)) * 100
                                )}
                                %
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div
                        className={
                          chatPanelExpanded
                            ? "fixed inset-0 z-[100] flex min-h-0 min-w-0 flex-col bg-zinc-950/97 p-3 shadow-[0_0_0_1px_rgba(63,63,70,0.45)] sm:p-5"
                            : "flex min-h-0 min-w-0 flex-1 flex-col pb-2"
                        }
                      >
                        {chatPanelExpanded ? (
                          <div className="mb-2 flex shrink-0 items-center justify-between gap-2 border-b border-zinc-700/45 pb-2">
                            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                              Chat expandido
                            </p>
                            <button
                              type="button"
                              onClick={() => setChatPanelExpanded(false)}
                              className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800/90 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-emerald-700/55 hover:text-emerald-200"
                            >
                              Reduzir
                            </button>
                          </div>
                        ) : null}
                        <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                          Chat · fala → texto
                          {captureChatSessionId ? (
                            <span className="ml-2 font-mono text-[8px] font-normal normal-case tracking-normal text-zinc-600">
                              · ficheiro: files/cache/chats/{captureChatSessionId}.json
                            </span>
                          ) : null}
                        </p>
                        <div
                          ref={chatScrollRef}
                          className={
                            chatPanelExpanded
                              ? "panel-bezel flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-md bg-[#0c1412] px-3 py-3 text-[12px] leading-relaxed shadow-[inset_0_0_20px_rgba(0,0,0,0.45)] ring-1 ring-zinc-600/45 sm:px-4 sm:py-3.5 sm:text-[13px]"
                              : "panel-bezel flex min-h-48 flex-1 flex-col gap-3 overflow-y-auto rounded-md bg-[#0c1412] px-3 py-3 text-[12px] leading-relaxed shadow-[inset_0_0_20px_rgba(0,0,0,0.45)] ring-1 ring-zinc-600/45 sm:px-4 sm:py-3.5 sm:text-[13px] lg:min-h-[min(32vh,20rem)]"
                          }
                        >
                          {!settings.speechLanguagesEnabled ? (
                            <p className="text-zinc-400">
                              Ative idiomas em Canais de entrada para enviar PCM ao
                              serviço Python (STT) e ver o texto aqui.
                            </p>
                          ) : running && serviceSttFailed ? (
                            <div className="space-y-2 text-zinc-400">
                              <p className="break-words font-mono text-[11px] leading-snug text-amber-200/90">
                                {serviceSttBootstrapError ??
                                  `STT não iniciou no echoLinkService (${echoLinkServiceOriginForDisplay()}).`}
                              </p>
                              <p className="text-[11px] leading-relaxed text-zinc-500">
                                {hintForServiceSttFailure(
                                  serviceSttBootstrapError ?? ""
                                )}
                              </p>
                            </div>
                          ) : running &&
                            !serviceSttReady &&
                            !serviceSttFailed ? (
                            <p className="text-zinc-500">
                              A ligar transcrição ao serviço (PCM 16 kHz)…
                            </p>
                          ) : (
                            <>
                              {transcriptLines.length === 0 && !interimTranscript ? (
                                <p className="text-emerald-600/95">
                                  <span className="text-emerald-500">▌</span>{" "}
                                  Pronto — inicie a captura e fale.
                                </p>
                              ) : null}
                              {transcriptLines.map((line) => {
                                const side = line.chatSpeaker === "other" ? "other" : "self";
                                const bubble =
                                  side === "self"
                                    ? "bg-emerald-950/80 ring-emerald-800/45"
                                    : "bg-zinc-800/85 ring-zinc-600/45";
                                return (
                                  <div
                                    key={line.id}
                                    className={`flex w-full ${side === "self" ? "justify-end" : "justify-start"}`}
                                  >
                                    <div
                                      className={`max-w-[min(88%,26rem)] space-y-1.5 rounded-2xl px-3 py-2.5 ring-1 ${bubble}`}
                                    >
                                      <p className="text-[13px] leading-snug text-emerald-200/95 sm:text-[14px]">
                                        <span className="text-emerald-500/90">▌ </span>
                                        {line.pt}
                                      </p>
                                      {line.en ? (
                                        <div className="space-y-1">
                                          <div className="flex flex-wrap items-start gap-2 sm:gap-3">
                                            <p className="min-w-0 flex-1 text-[13px] leading-snug text-sky-300/95 sm:text-[14px]">
                                              <span className="text-sky-500/85">◇ </span>
                                              {line.en}
                                            </p>
                                            {line.translationAudio ? (
                                              <button
                                                type="button"
                                                aria-label="Ouvir tradução em inglês novamente"
                                                onClick={() => {
                                                  const b = line.translationAudio;
                                                  if (!b) {
                                                    return;
                                                  }
                                                  const jk = line.journalKey;
                                                  setTranscriptLines((prev) =>
                                                    prev.map((l) => {
                                                      if (l.id !== line.id) {
                                                        return l;
                                                      }
                                                      const next =
                                                        (l.replayCount ?? 0) + 1;
                                                      if (l.voiceId) {
                                                        void patchTranscriptJournalSelected(
                                                          jk,
                                                          next,
                                                          l.voiceId
                                                        );
                                                      }
                                                      return { ...l, replayCount: next };
                                                    })
                                                  );
                                                  queueTranslationReplay(b);
                                                }}
                                                className="shrink-0 rounded-md border border-sky-800/60 bg-sky-950/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-200/95 transition hover:border-sky-600/70 hover:bg-sky-900/45"
                                              >
                                                Ouvir de novo
                                              </button>
                                            ) : null}
                                          </div>
                                          {line.translationOrigin ? (
                                            <p className="text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                                              {line.translationOrigin === "cache" ? (
                                                <span className="rounded border border-amber-900/55 bg-amber-950/35 px-1.5 py-0.5 text-amber-200/90">
                                                  Áudio · cache local
                                                </span>
                                              ) : (
                                                <span className="rounded border border-emerald-900/50 bg-emerald-950/30 px-1.5 py-0.5 text-emerald-200/90">
                                                  Áudio · API
                                                </span>
                                              )}
                                            </p>
                                          ) : null}
                                          {line.journalDate ? (
                                            <div className="mt-2 flex flex-wrap gap-2">
                                              <button
                                                type="button"
                                                aria-label="Copiar registo completo em JSON"
                                                onClick={() =>
                                                  void copyJournalPayloadJson(line)
                                                }
                                                className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800/80 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700/80"
                                              >
                                                Copiar JSON
                                              </button>
                                              <button
                                                type="button"
                                                aria-label="Copiar frase em português e tradução, sem Base64"
                                                onClick={() =>
                                                  void copyJournalPlainTexts(line)
                                                }
                                                className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800/80 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700/80"
                                              >
                                                Copiar textos
                                              </button>
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : voiceTranslationEnabled ? (
                                        <p className="text-[10px] text-zinc-500">
                                          A traduzir…
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                              {interimTranscript ? (
                                <div className="flex w-full justify-end">
                                  <div className="max-w-[min(88%,26rem)] rounded-2xl border border-amber-800/45 bg-amber-950/35 px-3 py-2 text-[13px] leading-snug text-amber-200/95 sm:text-[14px]">
                                    {interimTranscript}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                        <p className="mt-4 shrink-0 leading-snug text-[10px] uppercase tracking-wider text-zinc-400 sm:mt-5 sm:text-[11px]">
                          Chat: STT via echoLinkService (WS /ws/stt) · a sua fala à
                          direita; outras mensagens à esquerda. Cada início de
                          captura cria um JSON em files/cache/chats/ com cópia do
                          conteúdo.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : sidebarSection === "vocabulary" ? (
                <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
                  <div className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-zinc-600/35 pb-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Vocabulário
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                        Por voz: um IndexedDB por voz (
                        <span className="font-mono text-[9px] text-zinc-500">
                          echoLinkJournal__{"{"}hash16{"}"}
                        </span>
                        ) e registo{" "}
                        <span className="font-mono text-[9px] text-zinc-500">
                          echoLinkJournalRegistry
                        </span>
                        . Implementação em{" "}
                        <span className="font-mono text-[9px] text-zinc-500">
                          applications/echolinkApp/lib/transcriptJournalDb.ts
                        </span>
                        .
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshVocabulary()}
                      className={`${btnSecondary} shrink-0 flex-none`}
                    >
                      Atualizar
                    </button>
                  </div>
                  {vocabularyRegistryLoading &&
                  vocabularyVoiceBuckets.length === 0 ? (
                    <p className="text-[10px] text-zinc-500">A carregar…</p>
                  ) : vocabularyVoiceBuckets.length === 0 ? (
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Ainda não há vozes com frases guardadas. Ative a voz em
                      inglês no monitoramento e fale — cada voz passa a ter o seu
                      ficheiro local.
                    </p>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-4">
                      <aside className="flex shrink-0 flex-col gap-1 lg:w-52 lg:border-r lg:border-zinc-700/40 lg:pr-3">
                        <p className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                          Vozes com dados
                        </p>
                        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto lg:max-h-none lg:flex-col">
                          {vocabularyVoiceBuckets.map((b) => {
                            const active =
                              (vocabularySelectedVoiceId || "") === b.voiceId;
                            return (
                              <button
                                key={b.slug}
                                type="button"
                                title={b.voiceId || "Padrão do serviço"}
                                onClick={() =>
                                  setVocabularySelectedVoiceId(b.voiceId)
                                }
                                className={`rounded-md border px-2.5 py-2 text-left text-[10px] leading-snug transition lg:w-full ${
                                  active
                                    ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-200"
                                    : "border-zinc-700/55 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
                                }`}
                              >
                                {vocabularyVoicePrimaryLabel(b.voiceId)}
                              </button>
                            );
                          })}
                        </div>
                      </aside>
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {vocabularyLoading ? (
                          <p className="text-[10px] text-zinc-500">
                            A carregar entradas desta voz…
                          </p>
                        ) : vocabularyRows.length === 0 ? (
                          <p className="text-[10px] leading-relaxed text-zinc-500">
                            Nenhuma frase guardada para esta voz.
                          </p>
                        ) : (
                          <>
                            <p className="mb-2 shrink-0 text-[9px] uppercase tracking-wider text-zinc-500">
                              {vocabularyRows.length}{" "}
                              {vocabularyRows.length === 1
                                ? "entrada"
                                : "entradas"}{" "}
                              ·{" "}
                              {vocabularyVoicePrimaryLabel(
                                vocabularySelectedVoiceId ||
                                  vocabularyVoiceBuckets[0]?.voiceId ||
                                  ""
                              )}
                            </p>
                            <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-4">
                              {vocabularyRows.map((row) => (
                                <li
                                  key={row.journalKey}
                                  className="rounded-md border border-zinc-700/50 bg-zinc-950/55 p-3"
                                >
                                  <p className="text-[12px] leading-snug text-emerald-300/95 sm:text-[13px]">
                                    {row.fraseusuario}
                                  </p>
                                  <p className="mt-1.5 text-[12px] leading-snug text-sky-300/95 sm:text-[13px]">
                                    <span className="text-sky-500/85">◇ </span>
                                    {row.frasetranformada}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-zinc-500">
                                    <span>
                                      {(() => {
                                        try {
                                          return new Date(
                                            row.date
                                          ).toLocaleString(
                                            typeof navigator !== "undefined"
                                              ? navigator.language
                                              : "pt-PT"
                                          );
                                        } catch {
                                          return row.date;
                                        }
                                      })()}
                                    </span>
                                    <span className="max-w-[min(100%,18rem)] truncate">
                                      voice_id: {row.voice_id || "—"}
                                      {row.voice_label
                                        ? ` · ${row.voice_label}`
                                        : ""}
                                    </span>
                                    <span>selected: {row.selected}</span>
                                    <span className="text-zinc-600">
                                      audiobase64: {row.audiobase64.length} chars
                                    </span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      aria-label="Ouvir áudio da tradução"
                                      onClick={() =>
                                        playVocabularyRowAudio(row)
                                      }
                                      className="shrink-0 rounded-md border border-sky-800/60 bg-sky-950/40 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-sky-200/95 transition hover:border-sky-600/70 hover:bg-sky-900/45"
                                    >
                                      Ouvir
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copyVocabularyRowJson(row)
                                      }
                                      className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800/80 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700/80"
                                    >
                                      Copiar JSON
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void copyVocabularyPlainTexts(row)
                                      }
                                      className="shrink-0 rounded-md border border-zinc-600/60 bg-zinc-800/80 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-700/80"
                                    >
                                      Copiar textos
                                    </button>
                                    <button
                                      type="button"
                                      aria-label="Excluir entrada do vocabulário"
                                      onClick={() =>
                                        deleteVocabularyRow(row)
                                      }
                                      className="shrink-0 rounded-md border border-red-900/55 bg-red-950/35 px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-red-200/95 transition hover:border-red-700/60 hover:bg-red-950/55"
                                    >
                                      Excluir
                                    </button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : sidebarSection === "chats" ? (
                <div className="flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-4 sm:py-4">
                  <div className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 border-b border-zinc-600/35 pb-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Históricos
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                        Sessões em{" "}
                        <span className="font-mono text-[9px] text-zinc-500">
                          files/cache/chats/*.json
                        </span>{" "}
                        no echoLinkService.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setChatHistorySelectedId(null);
                        void (async () => {
                          setChatHistoryLoading(true);
                          const list = await fetchEchoLinkChatSessions();
                          setChatHistoryItems(list);
                          setChatHistoryLoading(false);
                        })();
                      }}
                      className={`${btnSecondary} shrink-0 flex-none`}
                    >
                      Atualizar
                    </button>
                  </div>
                  {chatHistoryLoading && chatHistoryItems.length === 0 ? (
                    <p className="text-[10px] text-zinc-500">A carregar…</p>
                  ) : chatHistoryItems.length === 0 ? (
                    <p className="text-[10px] leading-relaxed text-zinc-500">
                      Ainda não há sessões no histórico. Inicie a captura no
                      monitoramento para criar um ficheiro por sessão.
                    </p>
                  ) : (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-4">
                      <aside className="flex max-h-48 shrink-0 flex-col gap-1 overflow-hidden lg:max-h-none lg:w-56 lg:border-r lg:border-zinc-700/40 lg:pr-3">
                        <p className="mb-1 text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                          Sessões
                        </p>
                        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                          {chatHistoryItems.map((row) => {
                            const active = chatHistorySelectedId === row.sessionId;
                            return (
                              <button
                                key={row.sessionId}
                                type="button"
                                onClick={() =>
                                  setChatHistorySelectedId(row.sessionId)
                                }
                                className={`rounded-md border px-2.5 py-2 text-left text-[10px] leading-snug transition lg:w-full ${
                                  active
                                    ? "border-emerald-600/70 bg-emerald-950/40 text-emerald-200"
                                    : "border-zinc-700/55 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600"
                                }`}
                              >
                                <span className="block font-mono text-[9px] text-zinc-400">
                                  {row.fileName}
                                </span>
                                <span className="mt-0.5 block text-zinc-500">
                                  {row.messageCount}{" "}
                                  {row.messageCount === 1
                                    ? "mensagem"
                                    : "mensagens"}
                                </span>
                                {row.startedAt ? (
                                  <span className="mt-0.5 block text-[9px] text-zinc-600">
                                    {row.startedAt}
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </aside>
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {!chatHistorySelectedId ? (
                          <p className="text-[10px] text-zinc-500">
                            Selecione uma sessão à esquerda.
                          </p>
                        ) : chatHistoryDetailLoading ? (
                          <p className="text-[10px] text-zinc-500">
                            A carregar sessão…
                          </p>
                        ) : !chatHistoryDetail ? (
                          <p className="text-[10px] text-zinc-500">
                            Não foi possível ler esta sessão.
                          </p>
                        ) : (
                          <>
                            <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-500">
                                {chatHistoryDetail.sessionId ?? chatHistorySelectedId}{" "}
                                {chatHistoryDetail.endedAt
                                  ? "· encerrada"
                                  : "· sem data de fim no ficheiro"}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    JSON.stringify(
                                      {
                                        ...chatHistoryDetail,
                                        messages: chatHistoryDetail.messages,
                                      },
                                      null,
                                      2
                                    )
                                  );
                                }}
                                className={`${btnSecondary} shrink-0`}
                              >
                                Copiar JSON
                              </button>
                            </div>
                            {chatHistoryDetail.interimPt ? (
                              <p className="mb-2 shrink-0 rounded-md border border-amber-900/40 bg-amber-950/25 px-2 py-1.5 text-[10px] text-amber-200/90">
                                <span className="font-semibold text-amber-500/90">
                                  Provisório:{" "}
                                </span>
                                {chatHistoryDetail.interimPt}
                              </p>
                            ) : null}
                            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-md border border-zinc-800/60 bg-[#0c1412] p-3">
                              {chatHistoryDetail.messages.length === 0 ? (
                                <p className="text-[10px] text-zinc-500">
                                  Sem mensagens neste ficheiro.
                                </p>
                              ) : (
                                chatHistoryDetail.messages.map((m, idx) => {
                                  const pt =
                                    typeof m.pt === "string" ? m.pt : "";
                                  const en =
                                    typeof m.en === "string" ? m.en : "";
                                  const speaker =
                                    m.chatSpeaker === "other"
                                      ? "other"
                                      : "self";
                                  const bubble =
                                    speaker === "self"
                                      ? "bg-emerald-950/75 ring-emerald-800/40"
                                      : "bg-zinc-800/80 ring-zinc-600/45";
                                  const key =
                                    typeof m.id === "number"
                                      ? `m-${m.id}`
                                      : `m-${idx}`;
                                  return (
                                    <div
                                      key={key}
                                      className={`flex w-full ${speaker === "self" ? "justify-end" : "justify-start"}`}
                                    >
                                      <div
                                        className={`max-w-[min(92%,24rem)] space-y-1 rounded-xl px-2.5 py-2 ring-1 ${bubble}`}
                                      >
                                        <p className="text-[12px] leading-snug text-emerald-200/95">
                                          <span className="text-emerald-500/85">
                                            ▌{" "}
                                          </span>
                                          {pt || "—"}
                                        </p>
                                        {en ? (
                                          <p className="text-[12px] leading-snug text-sky-300/95">
                                            <span className="text-sky-500/85">
                                              ◇{" "}
                                            </span>
                                            {en}
                                          </p>
                                        ) : null}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : sidebarSection === "info" ? (
                <div className="p-3 sm:p-4">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                    Informações
                  </p>
                  <div className="mb-4 rounded-md border border-zinc-600/45 bg-zinc-950/50 px-3 py-2.5">
                    <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                      Visor · fluxo
                    </p>
                    <p className="text-[10px] uppercase leading-snug tracking-wide text-zinc-300 sm:text-[11px]">
                      {running
                        ? "Captura ligada — áudio ao serviço e texto via STT (nuvem ou Vosk)."
                        : "Iniciar envia áudio ao serviço e PCM para transcrição."}
                    </p>
                  </div>
                  <p className="mb-4 text-[10px] leading-relaxed text-zinc-400 sm:text-[11px]">
                    O painel envia chunks de áudio ao WebSocket do Python e, com
                    idiomas ativos, PCM 16 kHz para o endpoint de STT. O
                    Electron ou o browser servem só de interface.
                  </p>
                  <dl className="space-y-3 text-[10px] text-zinc-400 sm:text-[11px]">
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Configuração · idiomas
                      </dt>
                      <dd className="space-y-1.5 leading-relaxed">
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Idiomas ativos</span>
                          <span className="text-right text-zinc-200">
                            {settings.speechLanguagesEnabled ? "Sim" : "Não"}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Receber fala</span>
                          <span className="text-right text-zinc-200">
                            {getSpeechLanguageLabel(
                              settings.speechReceiveLanguage
                            )}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Transformar para</span>
                          <span className="text-right text-zinc-200">
                            {getSpeechLanguageLabel(
                              settings.speechTransformLanguage
                            )}
                          </span>
                        </div>
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Configuração · entrada (captura)
                      </dt>
                      <dd className="space-y-1.5 leading-relaxed">
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Sensibilidade</span>
                          <span className="tabular-nums text-zinc-200">
                            {settings.inputSensitivity}%
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Bloco (ms)</span>
                          <span className="tabular-nums text-zinc-200">
                            {settings.audioChunkMs}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Atraso texto (ms)</span>
                          <span className="tabular-nums text-zinc-200">
                            {settings.transcriptionStartDelayMs}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Corte visor (ms)</span>
                          <span className="tabular-nums text-zinc-200">
                            {settings.phraseSilenceCutMs}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Taxa de amostragem</span>
                          <span className="tabular-nums text-zinc-200">
                            {meterSampleRate > 0
                              ? `${meterSampleRate} Hz`
                              : "—"}
                          </span>
                        </div>
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Configuração · saída (monitor)
                      </dt>
                      <dd className="space-y-1.5 leading-relaxed">
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Saída alvo</span>
                          <span className="max-w-[58%] truncate text-right text-zinc-200">
                            {selectedOutputId
                              ? selectedOutputLabel ||
                                `${selectedOutputId.slice(0, 12)}…`
                              : "Padrão do sistema"}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Monitor entrada → saída</span>
                          <span className="text-right text-zinc-200">
                            {pipelineMonitorEnabled ? "Ligado" : "Desligado"}
                          </span>
                        </div>
                        <div className="flex flex-wrap justify-between gap-x-2 gap-y-0.5">
                          <span className="text-zinc-500">Ganho do monitor</span>
                          <span className="tabular-nums text-zinc-200">
                            {Math.round(pipelineMonitorGain * 100)}%
                          </span>
                        </div>
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        WebSocket · áudio (pipeline)
                      </dt>
                      <dd>
                        <code className="break-all text-emerald-300/95">
                          {getEchoLinkMicWebSocketUrl()}
                        </code>
                      </dd>
                      <dt className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        WebSocket · STT (PCM 16 kHz)
                      </dt>
                      <dd>
                        <code className="break-all text-emerald-300/95">
                          {getEchoLinkSttWebSocketUrl()}
                        </code>
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Interface
                      </dt>
                      <dd className="leading-relaxed">
                        Next.js · Web Audio · MediaRecorder · STT no echoLinkService
                        (Transcribe / Vosk)
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Privacidade
                      </dt>
                      <dd className="leading-relaxed">
                        Parâmetros de tempo ficam na memória local. A transcrição
                        corre no serviço Python (Transcribe em streaming na AWS ou
                        Vosk opcional), não no navegador.
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          </div>

        {error ? (
          <p
            className="border-t border-red-900/40 bg-red-950/35 px-3 py-2.5 text-[12px] text-red-200 sm:px-4 sm:text-[13px]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
    </div>
  );
}
