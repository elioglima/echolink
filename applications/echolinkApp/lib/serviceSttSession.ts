export const STT_WS_URL = "ws://127.0.0.1:8765/ws/stt";

const TARGET_RATE = 16000;

export type ServiceSttClientEvent =
  | { kind: "partial"; text: string }
  | { kind: "final"; text: string }
  | { kind: "error"; message: string };

function downsampleFloat(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) {
    return input;
  }
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
    }
    out[i] = sum / (end - start);
  }
  return out;
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
  sendPcm: (data: Int16Array) => void
): () => void {
  const proc = audioContext.createScriptProcessor(4096, 2, 2);
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  proc.onaudioprocess = (ev) => {
    const n = ev.inputBuffer.numberOfChannels;
    const L = ev.inputBuffer.getChannelData(0);
    const R = n > 1 ? ev.inputBuffer.getChannelData(1) : L;
    const mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      mono[i] = (L[i] + R[i]) * 0.5;
    }
    const down = downsampleFloat(mono, audioContext.sampleRate, TARGET_RATE);
    const i16 = floatToInt16(down);
    if (i16.byteLength > 0) {
      sendPcm(i16);
    }
  };
  source.connect(proc);
  proc.connect(mute);
  mute.connect(audioContext.destination);
  return () => {
    try {
      proc.disconnect();
      mute.disconnect();
      source.disconnect(proc);
    } catch {
      /* ignore */
    }
  };
}

export async function startServiceSttSession(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  onClientEvent: (ev: ServiceSttClientEvent) => void
): Promise<() => void> {
  const ws = new WebSocket(STT_WS_URL);
  ws.binaryType = "arraybuffer";

  await new Promise<void>((resolve, reject) => {
    ws.onerror = () => {
      reject(new Error("Falha na conexão WebSocket STT (serviço em 127.0.0.1:8765?)."));
    };
    ws.onopen = () => resolve();
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("STT: tempo esgotado aguardando modelo Vosk no serviço."));
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
  const detachTap = attachPcmTap(audioContext, source, sendPcm);

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
