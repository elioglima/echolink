"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  clampEchoLinkSetting,
  ECHO_LINK_SETTINGS_DEFAULTS,
  hydrateEchoLinkSettingsFromElectron,
  loadEchoLinkSettingsFromLocalStorage,
  saveEchoLinkSettingsToStorage,
  saveEchoLinkSpeechSettings,
  type EchoLinkSettings,
  type EchoLinkSettingsKey,
} from "../lib/echoLinkSettings";
import {
  connectMonitorBranch,
  type AudioPipelineInject,
} from "../lib/audioPipeline";
import {
  getSpeechLanguageLabel,
  SPEECH_LANGUAGE_OPTIONS,
} from "../lib/speechLanguages";
import { STT_WS_URL, startServiceSttSession } from "../lib/serviceSttSession";

const WS_URL = "ws://127.0.0.1:8765/ws/mic";
const RX_DECAY = 0.91;
const RX_SPIKE = 0.42;
const MIC_TEST_MS = 4000;
const METER_LOG_ALIGN_MIN = 0.055;
const METER_LOG_IDLE_SCALE = 0.22;
const CHUNK_MS_MIN = 50;
const CHUNK_MS_MAX = 4000;
const CUT_MS_MAX = 15000;
const INPUT_SENS_MIN = 10;
const INPUT_SENS_MAX = 400;

type AnalyserByteDomainBuffer = Parameters<
  AnalyserNode["getByteTimeDomainData"]
>[0];

function createByteDomainBuffer(size: number): AnalyserByteDomainBuffer {
  return new Uint8Array(new ArrayBuffer(size)) as AnalyserByteDomainBuffer;
}

function timingRangeProgress(value: number, min: number, max: number): string {
  if (max <= min) return "0%";
  const p = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, p))}%`;
}

function mapRmsToMeterLevel(
  rms: number,
  inputSensitivityPercent: number
): number {
  const gain = 3.6 * (inputSensitivityPercent / 100);
  const x = Math.min(1, rms * gain);
  return 1 - Math.exp(-2.85 * x);
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

type SidebarSection =
  | "audioIn"
  | "audioOut"
  | "monitor"
  | "info";

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

function formatMediaDeviceOptionLabel(
  d: MediaDeviceInfo,
  kind: "input" | "output",
  friendlyAlias?: string
): string {
  const idTail = d.deviceId.length >= 6 ? d.deviceId.slice(-6) : d.deviceId;
  const trimmed = friendlyAlias?.trim();
  if (trimmed) {
    return `${trimmed} · ${idTail}`;
  }
  const base =
    d.label?.trim() ||
    (kind === "input"
      ? `Entrada (${d.deviceId.slice(0, 10)}…)`
      : `Saída (${d.deviceId.slice(0, 10)}…)`);
  return `${base} · ${idTail}`;
}

export type MicCaptureProps = {
  audioPipelineInject?: AudioPipelineInject;
};

export function MicCapture({ audioPipelineInject }: MicCaptureProps = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pipelineBranchCleanupRef = useRef<(() => void) | null>(null);
  const pipelineGainNodeRef = useRef<GainNode | null>(null);
  const pipelineOutputAnalyserRef = useRef<AnalyserNode | null>(null);
  const pipelineOutBufRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const pipelineOutRafRef = useRef<number>(0);
  const pipelineOutSmoothRef = useRef(0);
  const pipelineInjectRef = useRef<AudioPipelineInject | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const timeDomainRef = useRef<AnalyserByteDomainBuffer | null>(null);
  const rxPulseRef = useRef(0);
  const micVuSmoothRef = useRef(0);
  const serviceSttCleanupRef = useRef<(() => void) | null>(null);
  const phraseSilenceCutMsRef = useRef(
    ECHO_LINK_SETTINGS_DEFAULTS.phraseSilenceCutMs
  );
  const inputSensitivityRef = useRef(ECHO_LINK_SETTINGS_DEFAULTS.inputSensitivity);
  const speechReceiveLangRef = useRef(
    ECHO_LINK_SETTINGS_DEFAULTS.speechReceiveLanguage
  );
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceBytes, setServiceBytes] = useState(0);
  const [serviceChunks, setServiceChunks] = useState(0);
  const [connected, setConnected] = useState(false);
  const [micVu, setMicVu] = useState(0);
  const [rxLevel, setRxLevel] = useState(0);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>("");
  const [selectedOutputId, setSelectedOutputId] = useState<string>("");
  const [micTesting, setMicTesting] = useState(false);
  const [outputTesting, setOutputTesting] = useState(false);
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [serviceSttReady, setServiceSttReady] = useState(false);
  const [serviceSttFailed, setServiceSttFailed] = useState(false);
  const [settings, setSettings] = useState<EchoLinkSettings>(() => ({
    ...ECHO_LINK_SETTINGS_DEFAULTS,
  }));
  const [sidebarSection, setSidebarSection] =
    useState<SidebarSection>("info");
  const [pipelineMonitorEnabled, setPipelineMonitorEnabled] = useState(false);
  const [pipelineMonitorGain, setPipelineMonitorGain] = useState(0.12);
  const pipelineMonitorGainRef = useRef(0.12);
  const [pipelineOutVu, setPipelineOutVu] = useState(0);
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
    pipelineMonitorGainRef.current = pipelineMonitorGain;
  }, [pipelineMonitorGain]);

  useEffect(() => {
    setSettings(loadEchoLinkSettingsFromLocalStorage());
    void hydrateEchoLinkSettingsFromElectron().then((merged) => {
      if (merged) setSettings(merged);
    });
  }, []);

  useEffect(() => {
    phraseSilenceCutMsRef.current = settings.phraseSilenceCutMs;
  }, [settings.phraseSilenceCutMs]);

  useEffect(() => {
    inputSensitivityRef.current = settings.inputSensitivity;
  }, [settings.inputSensitivity]);

  useEffect(() => {
    speechReceiveLangRef.current = settings.speechLanguagesEnabled
      ? settings.speechReceiveLanguage
      : ECHO_LINK_SETTINGS_DEFAULTS.speechReceiveLanguage;
  }, [
    settings.speechLanguagesEnabled,
    settings.speechReceiveLanguage,
  ]);

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

  useEffect(() => {
    const el = logScrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [transcriptLines, interimTranscript]);

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
    setPipelineVisibleDoneCount(0);
  }, [pipelineUtteranceVersion]);

  const stopServiceStt = useCallback(() => {
    serviceSttCleanupRef.current?.();
    serviceSttCleanupRef.current = null;
    setServiceSttReady(false);
    setServiceSttFailed(false);
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
    if (
      selectedInputId &&
      !audioInputs.some((d) => d.deviceId === selectedInputId)
    ) {
      setSelectedInputId("");
    }
  }, [audioInputs, selectedInputId]);

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
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    timeDomainRef.current = null;
    rxPulseRef.current = 0;
    micVuSmoothRef.current = 0;
    setMicVu(0);
    setRxLevel(0);
    setMeterSampleRate(0);
    setPipelineBranchLive(false);
  }, [stopPipelineOutLevelLoop]);

  const stopAll = useCallback(() => {
    stopServiceStt();
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    stopMeterLoop();
    setRunning(false);
    setConnected(false);
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
        const prev = pipelineOutSmoothRef.current;
        pipelineOutSmoothRef.current =
          instant > prev
            ? prev * 0.78 + instant * 0.22
            : prev * 0.91 + instant * 0.09;
        setPipelineOutVu(pipelineOutSmoothRef.current);
      }
      pipelineOutRafRef.current = requestAnimationFrame(tick);
    };
    pipelineOutRafRef.current = requestAnimationFrame(tick);
  }, []);

  const startMeter = useCallback(
    async (stream: MediaStream, withRx: boolean) => {
      micVuSmoothRef.current = 0;
      const ctx = new AudioContext();
      await ctx.resume().catch(() => undefined);
      setMeterSampleRate(ctx.sampleRate);
      const source = ctx.createMediaStreamSource(stream);
      mediaStreamSourceRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      timeDomainRef.current = createByteDomainBuffer(analyser.fftSize);

      const tick = () => {
        const a = analyserRef.current;
        const buf = timeDomainRef.current;
        if (a && buf) {
          a.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const instant = mapRmsToMeterLevel(
            rms,
            inputSensitivityRef.current
          );
          const prev = micVuSmoothRef.current;
          micVuSmoothRef.current =
            instant > prev
              ? prev * 0.78 + instant * 0.22
              : prev * 0.91 + instant * 0.09;
          setMicVu(micVuSmoothRef.current);
        }
        if (withRx) {
          rxPulseRef.current *= RX_DECAY;
          setRxLevel(rxPulseRef.current);
        }
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
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
      };
      if (selectedInputId) {
        audioConstraints.deviceId = { exact: selectedInputId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      testStreamRef.current = stream;
      await startMeter(stream, false);
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
    setError(null);
    setServiceBytes(0);
    setServiceChunks(0);
    setServiceChunksBaseline(0);
    setTranscriptLines([]);
    setInterimTranscript("");
    setServiceSttReady(false);
    setServiceSttFailed(false);
    setPipelineUtteranceVersion((v) => v + 1);
    rxPulseRef.current = 0;
    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
      };
      if (selectedInputId) {
        audioConstraints.deviceId = { exact: selectedInputId };
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      streamRef.current = stream;
      await startMeter(stream, true);

      const ws = new WebSocket(WS_URL);
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
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e: BlobEvent) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          const buf = await e.data.arrayBuffer();
          ws.send(buf);
        }
      };

      recorder.start(settings.audioChunkMs);
      setRunning(true);
      if (settings.transcriptionStartDelayMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, settings.transcriptionStartDelayMs);
        });
      }
      if (settings.speechLanguagesEnabled) {
        const ctx = audioContextRef.current;
        const src = mediaStreamSourceRef.current;
        if (!ctx || !src) {
          setServiceSttFailed(true);
          setError("STT: contexto de áudio indisponível.");
        } else {
          try {
            const cleanup = await startServiceSttSession(ctx, src, (ev) => {
              if (ev.kind === "partial") {
                setInterimTranscript(ev.text);
              }
              if (ev.kind === "final") {
                bumpPipelineUtteranceRef.current();
                setTranscriptLines((prev) => [...prev, ev.text]);
                setInterimTranscript("");
              }
              if (ev.kind === "error") {
                setError(ev.message);
              }
            });
            serviceSttCleanupRef.current = cleanup;
            setServiceSttReady(true);
            setServiceSttFailed(false);
          } catch (sttErr) {
            setServiceSttFailed(true);
            setServiceSttReady(false);
            const msg =
              sttErr instanceof Error
                ? sttErr.message
                : "STT: falha ao iniciar sessão com o serviço Python.";
            setError(msg);
          }
        }
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Não foi possível iniciar a captura.";
      setError(msg);
      stopAll();
    }
  };

  useEffect(() => {
    const g = pipelineGainNodeRef.current;
    if (g) {
      g.gain.value = pipelineMonitorGain;
    }
  }, [pipelineMonitorGain]);

  useEffect(() => {
    if (!running) return;
    const ctx = audioContextRef.current;
    const source = mediaStreamSourceRef.current;
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

  const busy = running || micTesting || outputTesting;

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

  const navEntries: { id: SidebarSection; label: string }[] = [
    { id: "info", label: "Informações" },
    { id: "audioIn", label: "Entrada de áudio" },
    { id: "audioOut", label: "Saída de áudio" },
    { id: "monitor", label: "Monitoramento" },
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
        detail: "Serviço Python (Vosk)",
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

  const meterForLogDisplay = useMemo(() => {
    const sttMeter =
      settings.speechLanguagesEnabled &&
      serviceSttReady &&
      !serviceSttFailed;
    if (!running || !sttMeter) {
      return micVu;
    }
    const aligned =
      interimTranscript.length > 0 ||
      transcriptLines.length > 0 ||
      micVu >= METER_LOG_ALIGN_MIN;
    return aligned ? micVu : micVu * METER_LOG_IDLE_SCALE;
  }, [
    running,
    settings.speechLanguagesEnabled,
    serviceSttReady,
    serviceSttFailed,
    micVu,
    interimTranscript,
    transcriptLines,
  ]);

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
                127.0.0.1:8765
              </code>
              {!running ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSidebarSection("monitor");
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
                  onClick={() => setSidebarSection(item.id)}
                  className={`app-region-no-drag ${navItemBase} min-w-30 touch-manipulation lg:min-w-0 lg:w-full ${sidebarSection === item.id ? navItemActive : navItemIdle}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            <div className="relative z-0 min-h-0 min-w-0 flex-1 overflow-y-auto bg-zinc-900">
              {sidebarSection === "audioIn" ? (
                <div className="divide-y divide-zinc-600/35">
                  <div className="border-b border-zinc-600/35 bg-zinc-900/60 px-3 py-2 sm:px-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                      Entrada de áudio
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      Microfone · fonte, idiomas e captura
                    </p>
                    <p className="mt-2 text-[9px] leading-snug text-zinc-500">
                      Os nomes vêm do navegador e podem diferir do macOS. O
                      sufixo após “·” identifica o dispositivo na Web.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-0 divide-y divide-zinc-600/35">
                    <section className="bg-zinc-900/50 p-3 sm:p-4">
                      <div className="mb-2.5 flex items-center gap-2 rounded-md bg-sky-950/25 px-2 py-1.5 ring-1 ring-sky-700/35">
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-sky-300 sm:text-[10px] sm:tracking-[0.2em]">
                          Microfone
                        </span>
                        <span className="text-[9px] text-zinc-400">
                          Canal 1
                        </span>
                      </div>
                      <label
                        htmlFor="echo-input-device"
                        className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                      >
                        Entrada
                      </label>
                      <select
                        id="echo-input-device"
                        className={selectClass}
                        disabled={busy}
                        value={selectedInputId}
                        onChange={(e) => setSelectedInputId(e.target.value)}
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
                          onClick={() => void testMicrophone()}
                          className={btnSky}
                        >
                          {micTesting ? "…" : "Testar mic"}
                        </button>
                      </div>
                    </section>

                    <section className="bg-zinc-900/50 p-3 sm:p-4">
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
                          Idiomas · fala e texto
                        </p>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings.speechLanguagesEnabled}
                          aria-label="Ativar idiomas personalizados"
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
                                speechTransformLanguage:
                                  prev.speechTransformLanguage,
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
                        Como cada idioma entra na pipeline. Desligado: só
                        português Brasil no reconhecimento.
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
                            htmlFor="speech-receive-lang"
                            className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                          >
                            Receber fala
                          </label>
                          <select
                            id="speech-receive-lang"
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
                                  speechLanguagesEnabled:
                                    prev.speechLanguagesEnabled,
                                  speechTransformLanguage:
                                    prev.speechTransformLanguage,
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
                            htmlFor="speech-transform-lang"
                            className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                          >
                            Transformar para
                          </label>
                          <select
                            id="speech-transform-lang"
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
                                  speechLanguagesEnabled:
                                    prev.speechLanguagesEnabled,
                                  speechReceiveLanguage:
                                    prev.speechReceiveLanguage,
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
                    </section>

                    <section className="bg-zinc-900/50 p-3 sm:p-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
                        Captura · medidor e tempo
                      </p>
                      <p className="mb-3 text-[9px] leading-snug text-zinc-500">
                        Sensibilidade do VU, blocos ao serviço e corte do texto
                        no visor. Valores salvos automaticamente.
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
                              setSettingsField(
                                "inputSensitivity",
                                e.target.value
                              )
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
                            Duração de cada bloco enviado ao serviço. Vale na
                            próxima captura ou ao reiniciar.
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
                            Espera antes de ligar o reconhecimento de voz após
                            iniciar a captura.
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
                              setSettingsField(
                                "phraseSilenceCutMs",
                                e.target.value
                              )
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
                            Silêncio após texto provisório para fechar linha no
                            log. Pode ajustar com a captura ligada.
                          </p>
                        </div>
                        <dl className="border-t border-zinc-700/40 pt-3">
                          <div className="flex justify-between gap-2 text-[10px] text-zinc-400">
                            <dt>Taxa de amostragem</dt>
                            <dd className="tabular-nums text-zinc-300">
                              {meterSampleRate > 0
                                ? `${meterSampleRate} Hz`
                                : "—"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </section>
                  </div>
                </div>
              ) : sidebarSection === "audioOut" ? (
                <div className="divide-y divide-zinc-600/35">
                  <div className="border-b border-zinc-600/35 bg-zinc-900/60 px-3 py-2 sm:px-4">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                      Saída de áudio
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">
                      Fones · monitor e tradução
                    </p>
                    <p className="mt-2 text-[9px] leading-snug text-zinc-500">
                      Os nomes vêm do navegador e podem diferir do macOS. O
                      sufixo após “·” identifica o dispositivo na Web.
                    </p>
                  </div>
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
                        onChange={(e) => setSelectedOutputId(e.target.value)}
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
                                speechTransformLanguage:
                                  prev.speechTransformLanguage,
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
                        Idioma da fala e idioma alvo do texto. Desligado: só
                        português (Brasil) no reconhecimento.
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
                            htmlFor="speech-receive-lang-out"
                            className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                          >
                            Receber fala
                          </label>
                          <select
                            id="speech-receive-lang-out"
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
                                  speechLanguagesEnabled:
                                    prev.speechLanguagesEnabled,
                                  speechTransformLanguage:
                                    prev.speechTransformLanguage,
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
                            htmlFor="speech-transform-lang-out"
                            className="mb-1.5 block text-[9px] uppercase tracking-[0.18em] text-zinc-400"
                          >
                            Transformar para
                          </label>
                          <select
                            id="speech-transform-lang-out"
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
                                  speechLanguagesEnabled:
                                    prev.speechLanguagesEnabled,
                                  speechReceiveLanguage:
                                    prev.speechReceiveLanguage,
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
                            onChange={(e) =>
                              setPipelineMonitorEnabled(e.target.checked)
                            }
                          />
                          Monitorar entrada → saída
                        </label>
                        <span className="text-[10px] text-zinc-500">
                          {running
                            ? pipelineMonitorEnabled
                              ? "Ativo no fluxo atual"
                              : "Desligado"
                            : "Ligue a captura para ouvir"}
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
                          disabled={!running || busy}
                          value={Math.round(pipelineMonitorGain * 100)}
                          onChange={(e) =>
                            setPipelineMonitorGain(
                              Math.max(0.01, Number(e.target.value) / 100)
                            )
                          }
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
                </div>
              ) : sidebarSection === "monitor" ? (
                <div className="flex min-h-0 flex-col px-3 py-3 sm:px-4 sm:py-4">
                  <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-zinc-600/35 pb-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-200">
                        Monitoramento
                      </p>
                      <p className="mt-1 text-[10px] leading-snug text-zinc-400">
                        Etapas · medidores · log · ajustes finos nos menus Entrada
                        e Saída
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
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setTranscriptLines([]);
                        setInterimTranscript("");
                        bumpPipelineUtterance();
                      }}
                      className="shrink-0 text-[11px] uppercase tracking-wide text-zinc-400 transition hover:text-amber-400 disabled:opacity-45"
                    >
                      Limpar log
                    </button>
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
                              Saída de áudio
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
                              Monitor local e ganho: menu Saída de áudio.
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
                            Níveis pré/pós pipeline. Monitor e ganho em Saída de
                            áudio. Injeção opcional via{" "}
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

                      <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-2">
                        <p className="mb-3 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                          Log · fala → texto
                        </p>
                        <div
                          ref={logScrollRef}
                          className="panel-bezel min-h-48 flex-1 space-y-2 overflow-y-auto rounded-md bg-[#0c1412] px-4 py-3 text-[12px] leading-relaxed text-emerald-300 shadow-[inset_0_0_20px_rgba(0,0,0,0.45)] ring-1 ring-zinc-600/45 sm:px-4 sm:py-3.5 sm:text-[13px] lg:min-h-[min(32vh,20rem)]"
                        >
                          {!settings.speechLanguagesEnabled ? (
                            <p className="text-zinc-400">
                              Ative idiomas em Entrada de áudio para enviar PCM ao
                              serviço Python (Vosk) e ver o texto aqui.
                            </p>
                          ) : running && serviceSttFailed ? (
                            <p className="text-zinc-400">
                              STT indisponível. Confirme que o echoLinkService está
                              a correr em 127.0.0.1:8765, com{" "}
                              <code className="text-emerald-400/90">pip install vosk</code>{" "}
                              e variável{" "}
                              <code className="text-emerald-400/90">VOSK_MODEL_PATH</code>{" "}
                              apontando para a pasta do modelo.
                            </p>
                          ) : running &&
                            !serviceSttReady &&
                            !serviceSttFailed ? (
                            <p className="text-zinc-500">
                              A ligar transcrição ao serviço Python (PCM 16 kHz)…
                            </p>
                          ) : (
                            <>
                              {transcriptLines.length === 0 && !interimTranscript ? (
                                <p className="text-emerald-600/95">
                                  <span className="text-emerald-500">▌</span>{" "}
                                  Pronto — inicie a captura e fale.
                                </p>
                              ) : null}
                              {transcriptLines.map((line, idx) => (
                                <p key={`${idx}-${line.slice(0, 24)}`}>
                                  <span className="text-emerald-500/90">▌ </span>
                                  {line}
                                </p>
                              ))}
                              {interimTranscript ? (
                                <p className="text-amber-300">{interimTranscript}</p>
                              ) : null}
                            </>
                          )}
                        </div>
                        <p className="mt-4 shrink-0 leading-snug text-[10px] uppercase tracking-wider text-zinc-400 sm:mt-5 sm:text-[11px]">
                          Texto via Vosk no serviço Python (WS /ws/stt) · o painel só
                          envia PCM
                        </p>
                      </div>
                    </div>
                  </div>
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
                        ? "Captura ligada — áudio ao serviço e texto via Vosk."
                        : "Iniciar envia áudio ao serviço e PCM para transcrição."}
                    </p>
                  </div>
                  <p className="mb-4 text-[10px] leading-relaxed text-zinc-400 sm:text-[11px]">
                    O painel envia chunks de áudio ao WebSocket do Python e, com
                    idiomas ativos, PCM 16 kHz para o endpoint de STT (Vosk). O
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
                        <code className="break-all text-emerald-300/95">{WS_URL}</code>
                      </dd>
                      <dt className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        WebSocket · STT (PCM 16 kHz)
                      </dt>
                      <dd>
                        <code className="break-all text-emerald-300/95">{STT_WS_URL}</code>
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Interface
                      </dt>
                      <dd className="leading-relaxed">
                        Next.js · Web Audio · MediaRecorder · STT no echoLinkService
                        (Vosk)
                      </dd>
                    </div>
                    <div className="rounded-md border border-zinc-700/50 bg-zinc-950/40 px-3 py-2.5">
                      <dt className="mb-1 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        Privacidade
                      </dt>
                      <dd className="leading-relaxed">
                        Parâmetros de tempo ficam na memória local. A transcrição
                        processa-se no serviço Python local (Vosk), não no
                        navegador.
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
