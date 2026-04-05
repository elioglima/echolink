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
  dispose: () => void;
  controls: MixGainControls;
  primaryAnalyser: AnalyserNode;
  secondaryAnalyser: AnalyserNode;
};

export async function mixCaptureAudioStreams(
  primary: MediaStream,
  secondary: MediaStream,
  options?: { primaryLinear?: number; secondaryLinear?: number }
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
  src1.connect(g1);
  src2.connect(g2);
  g1.connect(a1);
  a1.connect(dest);
  g2.connect(a2);
  a2.connect(dest);
  const dispose = () => {
    try {
      src1.disconnect();
      src2.disconnect();
      g1.disconnect();
      g2.disconnect();
      a1.disconnect();
      a2.disconnect();
      dest.disconnect();
    } catch {
      /* ignore */
    }
    primary.getTracks().forEach((t) => t.stop());
    secondary.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    mixedStream: dest.stream,
    dispose,
    primaryAnalyser: a1,
    secondaryAnalyser: a2,
    controls: {
      setPrimaryLinear: (n: number) => {
        g1.gain.value = HEADROOM * clampLinear(n);
      },
      setSecondaryLinear: (n: number) => {
        g2.gain.value = HEADROOM * clampLinear(n);
      },
    },
  };
}

export type PassThroughCaptureResult = {
  stream: MediaStream;
  dispose: () => void;
  setGainLinear: (n: number) => void;
  primaryAnalyser: AnalyserNode;
};

export async function passThroughCaptureWithGain(
  stream: MediaStream,
  gainLinear = 1
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
  src.connect(g);
  g.connect(a);
  a.connect(dest);
  const dispose = () => {
    try {
      src.disconnect();
      g.disconnect();
      a.disconnect();
      dest.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    stream: dest.stream,
    dispose,
    primaryAnalyser: a,
    setGainLinear: (n: number) => {
      g.gain.value = HEADROOM * clampLinear(n);
    },
  };
}
