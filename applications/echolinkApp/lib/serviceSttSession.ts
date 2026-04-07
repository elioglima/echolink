import { applyMaxChannelWebAudioNodes } from "./echoLinkMultiChannelAudio";
import {
  echoLinkServiceOriginForDisplay,
  getEchoLinkSttWebSocketUrl,
} from "./echoLinkLocalTransport";

export { getEchoLinkSttWebSocketUrl } from "./echoLinkLocalTransport";

const TARGET_RATE = 16000;
const STT_LOWPASS_HZ = 7200;
const STT_INPUT_RMS_FLOOR = 0.0015;
const STT_PEAK_CEILING = 0.88;
const STT_INPUT_GAIN_MIN = 0.35;
const STT_INPUT_GAIN_MAX = 8;

export type ServiceSttClientEvent =
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; message: string };

function resampleFloatLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }
  const outLen = Math.max(
    1,
    Math.floor((input.length * outputRate) / inputRate)
  );
  const out = new Float32Array(outLen);
  const ratio = inputRate / outputRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const f = pos - j;
    const j1 = Math.min(j + 1, input.length - 1);
    const s0 = input[j] ?? 0;
    const s1 = input[j1] ?? s0;
    out[i] = s0 + f * (s1 - s0);
  }
  return out;
}

function normalizePeakForStt(mono: Float32Array, ceiling: number): void {
  let peak = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i] ?? 0);
    if (a > peak) {
      peak = a;
    }
  }
  if (peak <= ceiling || peak <= 0) {
    return;
  }
  const g = ceiling / peak;
  for (let i = 0; i < mono.length; i++) {
    mono[i] = (mono[i] ?? 0) * g;
  }
}

function rmsOfFloat32(buf: Float32Array): number {
  if (buf.length === 0) {
    return 0;
  }
  let s = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s / buf.length);
}

function floatToInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

function attachPcmTap(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  sendPcm: (data: Int16Array) => void,
  inputSensitivityPercent?: number
): () => void {
  const sens = inputSensitivityPercent ?? 100;
  const gainLinear = Math.min(
    STT_INPUT_GAIN_MAX,
    Math.max(STT_INPUT_GAIN_MIN, sens / 100)
  );
  const lowpass = audioContext.createBiquadFilter();
  lowpass.type = "lowpass";
  const nyquistIn = audioContext.sampleRate * 0.5;
  lowpass.frequency.value = Math.min(STT_LOWPASS_HZ, nyquistIn * 0.92);
  lowpass.Q.value = 0.707;

  const proc = audioContext.createScriptProcessor(2048, 8, 2);
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  applyMaxChannelWebAudioNodes(lowpass);
  proc.onaudioprocess = (ev) => {
    const n = ev.inputBuffer.numberOfChannels;
    const len = ev.inputBuffer.length;
    const mono = new Float32Array(len);
    if (n <= 0) {
      return;
    }
    for (let ch = 0; ch < n; ch++) {
      const c = ev.inputBuffer.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        mono[i] += c[i] ?? 0;
      }
    }
    const inv = (1 / n) * gainLinear;
    for (let i = 0; i < len; i++) {
      mono[i] *= inv;
    }
    normalizePeakForStt(mono, STT_PEAK_CEILING);
    if (rmsOfFloat32(mono) < STT_INPUT_RMS_FLOOR) {
      mono.fill(0);
    }
    const resampled = resampleFloatLinear(
      mono,
      audioContext.sampleRate,
      TARGET_RATE
    );
    const i16 = floatToInt16(resampled);
    if (i16.byteLength > 0) {
      sendPcm(i16);
    }
  };
  source.connect(lowpass);
  lowpass.connect(proc);
  proc.connect(mute);
  mute.connect(audioContext.destination);
  return () => {
    try {
      proc.disconnect();
      mute.disconnect();
      lowpass.disconnect(proc);
      source.disconnect(lowpass);
    } catch {
      /* ignore */
    }
  };
}

export type StartServiceSttSessionOptions = {
  phraseSilenceCutMs?: number;
  inputSensitivityPercent?: number;
};

export async function startServiceSttSession(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  onClientEvent: (ev: ServiceSttClientEvent) => void,
  options?: StartServiceSttSessionOptions
): Promise<() => void> {
  const ws = new WebSocket(getEchoLinkSttWebSocketUrl(options?.phraseSilenceCutMs));
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => {
      reject(
        new Error(
          `Falha na conexão WebSocket STT (serviço em ${echoLinkServiceOriginForDisplay()}?).`
        )
      );
    };
    ws.onopen = () => resolve();
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("STT: tempo esgotado aguardando o serviço ficar pronto."));
    }, 120000);
    const onFirst = (ev: MessageEvent) => {
      window.clearTimeout(timeout);
      try {
        const j = JSON.parse(String(ev.data)) as {
          type?: string;
          message?: string;
        };
        if (j.type === "ready") {
          ws.removeEventListener("message", onFirst);
          resolve();
        } else if (j.type === "error") {
          ws.removeEventListener("message", onFirst);
          reject(new Error(j.message || "STT: erro do serviço"));
        } else {
          ws.removeEventListener("message", onFirst);
          reject(new Error("STT: resposta inesperada do serviço"));
        }
      } catch (e) {
        ws.removeEventListener("message", onFirst);
        reject(e instanceof Error ? e : new Error("STT: parse"));
      }
    };
    ws.addEventListener("message", onFirst);
  });

  ws.onmessage = (ev) => {
    try {
      const j = JSON.parse(String(ev.data)) as {
        type?: string;
        text?: string;
        message?: string;
      };
      if (j.type === "partial" && typeof j.text === "string") {
        onClientEvent({ kind: "partial", text: j.text });
      }
      if (j.type === "final" && typeof j.text === "string") {
        onClientEvent({ kind: "final", text: j.text });
      }
      if (j.type === "error" && typeof j.message === "string") {
        onClientEvent({ kind: "error", message: j.message });
      }
    } catch {
      /* ignore */
    }
  };

  const sendPcm = (data: Int16Array) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };
  const detachTap = attachPcmTap(
    audioContext,
    source,
    sendPcm,
    options?.inputSensitivityPercent
  );

  return () => {
    detachTap();
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };
}
