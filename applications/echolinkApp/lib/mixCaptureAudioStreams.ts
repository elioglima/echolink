import { applyMaxChannelWebAudioNodes } from "./echoLinkMultiChannelAudio";
import { safeCloseAudioContext } from "./safeCloseAudioContext";

const HEADROOM = 0.92;

function clampLinear(n: number): number {
  return Math.max(0, Math.min(2, n));
}

export type MixGainControls = {
  setPrimaryLinear: (n: number) => void;
  setSecondaryLinear: (n: number) => void;
};

export type MixedCaptureResult = {
  mixedStream: MediaStream;
  monitorStream: MediaStream;
  dispose: () => void;
  controls: MixGainControls;
  primaryAnalyser: AnalyserNode;
  secondaryAnalyser: AnalyserNode;
};

export async function mixCaptureAudioStreams(
  primary: MediaStream,
  secondary: MediaStream,
  options?: {
    primaryLinear?: number;
    secondaryLinear?: number;
    monitorExcludePrimary?: boolean;
  }
): Promise<MixedCaptureResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  const dest = ctx.createMediaStreamDestination();
  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  const a1 = ctx.createAnalyser();
  const a2 = ctx.createAnalyser();
  a1.fftSize = 512;
  a2.fftSize = 512;
  a1.smoothingTimeConstant = 0.75;
  a2.smoothingTimeConstant = 0.75;
  const p0 = clampLinear(options?.primaryLinear ?? 1);
  const s0 = clampLinear(options?.secondaryLinear ?? 1);
  g1.gain.value = HEADROOM * p0;
  g2.gain.value = HEADROOM * s0;
  const src1 = ctx.createMediaStreamSource(primary);
  const src2 = ctx.createMediaStreamSource(secondary);
  applyMaxChannelWebAudioNodes(dest, g1, g2, a1, a2);
  src1.connect(g1);
  src2.connect(g2);
  g1.connect(a1);
  a1.connect(dest);
  g2.connect(a2);
  a2.connect(dest);
  const exclude = Boolean(options?.monitorExcludePrimary);
  let monitorDest: MediaStreamAudioDestinationNode | null = null;
  let g1m: GainNode | null = null;
  let g2m: GainNode | null = null;
  if (exclude) {
    monitorDest = ctx.createMediaStreamDestination();
    g1m = ctx.createGain();
    g2m = ctx.createGain();
    g1m.gain.value = 0;
    g2m.gain.value = HEADROOM * s0;
    applyMaxChannelWebAudioNodes(monitorDest, g1m, g2m);
    src1.connect(g1m);
    g1m.connect(monitorDest);
    src2.connect(g2m);
    g2m.connect(monitorDest);
  }
  const monitorStream = exclude ? monitorDest!.stream : dest.stream;
  const dispose = () => {
    try {
      src1.disconnect();
      src2.disconnect();
      g1.disconnect();
      g2.disconnect();
      a1.disconnect();
      a2.disconnect();
      dest.disconnect();
      if (g1m) {
        g1m.disconnect();
      }
      if (g2m) {
        g2m.disconnect();
      }
      if (monitorDest) {
        monitorDest.disconnect();
      }
    } catch {
      /* ignore */
    }
    primary.getTracks().forEach((t) => t.stop());
    secondary.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    mixedStream: dest.stream,
    monitorStream,
    dispose,
    primaryAnalyser: a1,
    secondaryAnalyser: a2,
    controls: {
      setPrimaryLinear: (n: number) => {
        g1.gain.value = HEADROOM * clampLinear(n);
      },
      setSecondaryLinear: (n: number) => {
        const v = HEADROOM * clampLinear(n);
        g2.gain.value = v;
        if (g2m) {
          g2m.gain.value = v;
        }
      },
    },
  };
}

export type PassThroughCaptureResult = {
  stream: MediaStream;
  monitorStream: MediaStream;
  dispose: () => void;
  setGainLinear: (n: number) => void;
  primaryAnalyser: AnalyserNode;
};

export async function passThroughCaptureWithGain(
  stream: MediaStream,
  gainLinear = 1,
  options?: { monitorExcludePrimary?: boolean }
): Promise<PassThroughCaptureResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  const dest = ctx.createMediaStreamDestination();
  const g = ctx.createGain();
  const a = ctx.createAnalyser();
  a.fftSize = 512;
  a.smoothingTimeConstant = 0.75;
  g.gain.value = HEADROOM * clampLinear(gainLinear);
  const src = ctx.createMediaStreamSource(stream);
  applyMaxChannelWebAudioNodes(dest, g, a);
  src.connect(g);
  g.connect(a);
  a.connect(dest);
  const exclude = Boolean(options?.monitorExcludePrimary);
  let monitorDest: MediaStreamAudioDestinationNode | null = null;
  let gMon: GainNode | null = null;
  if (exclude) {
    monitorDest = ctx.createMediaStreamDestination();
    gMon = ctx.createGain();
    gMon.gain.value = 0;
    src.connect(gMon);
    gMon.connect(monitorDest);
  }
  const monitorStream = exclude ? monitorDest!.stream : dest.stream;
  const dispose = () => {
    try {
      src.disconnect();
      g.disconnect();
      a.disconnect();
      dest.disconnect();
      if (gMon) {
        gMon.disconnect();
      }
      if (monitorDest) {
        monitorDest.disconnect();
      }
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    stream: dest.stream,
    monitorStream,
    dispose,
    primaryAnalyser: a,
    setGainLinear: (n: number) => {
      g.gain.value = HEADROOM * clampLinear(n);
    },
  };
}

export type MixTripleGainControls = {
  setPrimaryLinear: (n: number) => void;
  setSecondaryLinear: (n: number) => void;
  setTertiaryLinear: (n: number) => void;
};

export type MixedCaptureTripleResult = {
  mixedStream: MediaStream;
  monitorStream: MediaStream;
  dispose: () => void;
  controls: MixTripleGainControls;
  primaryAnalyser: AnalyserNode;
  secondaryAnalyser: AnalyserNode;
  tertiaryAnalyser: AnalyserNode;
};

export async function mixCaptureAudioStreamsTriple(
  primary: MediaStream,
  secondary: MediaStream,
  tertiary: MediaStream,
  options?: {
    primaryLinear?: number;
    secondaryLinear?: number;
    tertiaryLinear?: number;
    monitorExcludePrimary?: boolean;
  }
): Promise<MixedCaptureTripleResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  const dest = ctx.createMediaStreamDestination();
  const g1 = ctx.createGain();
  const g2 = ctx.createGain();
  const g3 = ctx.createGain();
  const a1 = ctx.createAnalyser();
  const a2 = ctx.createAnalyser();
  const a3 = ctx.createAnalyser();
  a1.fftSize = 512;
  a2.fftSize = 512;
  a3.fftSize = 512;
  a1.smoothingTimeConstant = 0.75;
  a2.smoothingTimeConstant = 0.75;
  a3.smoothingTimeConstant = 0.75;
  const p0 = clampLinear(options?.primaryLinear ?? 1);
  const s0 = clampLinear(options?.secondaryLinear ?? 1);
  const t0 = clampLinear(options?.tertiaryLinear ?? 1);
  g1.gain.value = HEADROOM * p0;
  g2.gain.value = HEADROOM * s0;
  g3.gain.value = HEADROOM * t0;
  const src1 = ctx.createMediaStreamSource(primary);
  const src2 = ctx.createMediaStreamSource(secondary);
  const src3 = ctx.createMediaStreamSource(tertiary);
  applyMaxChannelWebAudioNodes(dest, g1, g2, g3, a1, a2, a3);
  src1.connect(g1);
  src2.connect(g2);
  src3.connect(g3);
  g1.connect(a1);
  a1.connect(dest);
  g2.connect(a2);
  a2.connect(dest);
  g3.connect(a3);
  a3.connect(dest);
  const exclude = Boolean(options?.monitorExcludePrimary);
  let monitorDest: MediaStreamAudioDestinationNode | null = null;
  let g1m: GainNode | null = null;
  let g2m: GainNode | null = null;
  let g3m: GainNode | null = null;
  if (exclude) {
    monitorDest = ctx.createMediaStreamDestination();
    g1m = ctx.createGain();
    g2m = ctx.createGain();
    g3m = ctx.createGain();
    g1m.gain.value = 0;
    g2m.gain.value = HEADROOM * s0;
    g3m.gain.value = HEADROOM * t0;
    applyMaxChannelWebAudioNodes(monitorDest, g1m, g2m, g3m);
    src1.connect(g1m);
    g1m.connect(monitorDest);
    src2.connect(g2m);
    g2m.connect(monitorDest);
    src3.connect(g3m);
    g3m.connect(monitorDest);
  }
  const monitorStream = exclude ? monitorDest!.stream : dest.stream;
  const dispose = () => {
    try {
      src1.disconnect();
      src2.disconnect();
      src3.disconnect();
      g1.disconnect();
      g2.disconnect();
      g3.disconnect();
      a1.disconnect();
      a2.disconnect();
      a3.disconnect();
      dest.disconnect();
      if (g1m) {
        g1m.disconnect();
      }
      if (g2m) {
        g2m.disconnect();
      }
      if (g3m) {
        g3m.disconnect();
      }
      if (monitorDest) {
        monitorDest.disconnect();
      }
    } catch {
      /* ignore */
    }
    primary.getTracks().forEach((t) => t.stop());
    secondary.getTracks().forEach((t) => t.stop());
    tertiary.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    mixedStream: dest.stream,
    monitorStream,
    dispose,
    primaryAnalyser: a1,
    secondaryAnalyser: a2,
    tertiaryAnalyser: a3,
    controls: {
      setPrimaryLinear: (n: number) => {
        g1.gain.value = HEADROOM * clampLinear(n);
      },
      setSecondaryLinear: (n: number) => {
        const v = HEADROOM * clampLinear(n);
        g2.gain.value = v;
        if (g2m) {
          g2m.gain.value = v;
        }
      },
      setTertiaryLinear: (n: number) => {
        const v = HEADROOM * clampLinear(n);
        g3.gain.value = v;
        if (g3m) {
          g3m.gain.value = v;
        }
      },
    },
  };
}
