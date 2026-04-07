import { applyMaxChannelWebAudioNodes } from "./echoLinkMultiChannelAudio";
import { safeCloseAudioContext } from "./safeCloseAudioContext";

const HEADROOM = 0.92;

function clampLinear(n: number): number {
  return Math.max(0, Math.min(2, n));
}

export type ChannelRoutePair = {
  master: boolean;
  monitor: boolean;
};

const ROUTE_DEFAULT: ChannelRoutePair = {
  master: true,
  monitor: true,
};

function routeToMasterLinear(route: ChannelRoutePair): number {
  if (!route.master && !route.monitor) {
    return 1;
  }
  return route.master ? 1 : 0;
}

function routeToMonitorLinear(route: ChannelRoutePair): number {
  if (!route.master && !route.monitor) {
    return 1;
  }
  return route.monitor ? 1 : 0;
}

export type MixGainControls = {
  setPrimaryLinear: (n: number) => void;
  setSecondaryLinear: (n: number) => void;
  setPrimaryRouteMaster: (on: boolean) => void;
  setPrimaryRouteMonitor: (on: boolean) => void;
  setSecondaryRouteMaster: (on: boolean) => void;
  setSecondaryRouteMonitor: (on: boolean) => void;
  setPrimaryExcludeFromProgramBus: (on: boolean) => void;
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
    primaryExcludeFromProgramBus?: boolean;
    primaryRoute?: ChannelRoutePair;
    secondaryRoute?: ChannelRoutePair;
  }
): Promise<MixedCaptureResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  let cur1: ChannelRoutePair = {
    ...(options?.primaryRoute ?? ROUTE_DEFAULT),
  };
  let cur2: ChannelRoutePair = {
    ...(options?.secondaryRoute ?? ROUTE_DEFAULT),
  };

  const masterDest = ctx.createMediaStreamDestination();
  const monitorDest = ctx.createMediaStreamDestination();
  applyMaxChannelWebAudioNodes(masterDest, monitorDest);

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

  const rm1 = ctx.createGain();
  const rm2 = ctx.createGain();
  const rmon1 = ctx.createGain();
  const rmon2 = ctx.createGain();
  rm2.gain.value = routeToMasterLinear(cur2);
  rmon2.gain.value = routeToMonitorLinear(cur2);
  let primaryExcludeFromProgramBus =
    options?.primaryExcludeFromProgramBus ?? false;
  const syncPrimaryProgramBusGains = () => {
    if (primaryExcludeFromProgramBus) {
      rm1.gain.value = 0;
      rmon1.gain.value = 0;
    } else {
      rm1.gain.value = routeToMasterLinear(cur1);
      rmon1.gain.value = routeToMonitorLinear(cur1);
    }
  };
  syncPrimaryProgramBusGains();

  const src1 = ctx.createMediaStreamSource(primary);
  const src2 = ctx.createMediaStreamSource(secondary);
  applyMaxChannelWebAudioNodes(g1, g2, a1, a2, rm1, rm2, rmon1, rmon2);
  src1.connect(g1);
  src2.connect(g2);
  g1.connect(a1);
  g2.connect(a2);
  g1.connect(rm1);
  rm1.connect(masterDest);
  g2.connect(rm2);
  rm2.connect(masterDest);
  g1.connect(rmon1);
  rmon1.connect(monitorDest);
  g2.connect(rmon2);
  rmon2.connect(monitorDest);

  const dispose = () => {
    try {
      src1.disconnect();
      src2.disconnect();
      g1.disconnect();
      g2.disconnect();
      a1.disconnect();
      a2.disconnect();
      rm1.disconnect();
      rm2.disconnect();
      rmon1.disconnect();
      rmon2.disconnect();
      masterDest.disconnect();
      monitorDest.disconnect();
    } catch {
      /* ignore */
    }
    primary.getTracks().forEach((t) => t.stop());
    secondary.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    mixedStream: masterDest.stream,
    monitorStream: monitorDest.stream,
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
      setPrimaryRouteMaster: (on: boolean) => {
        cur1 = { ...cur1, master: on };
        syncPrimaryProgramBusGains();
      },
      setPrimaryRouteMonitor: (on: boolean) => {
        cur1 = { ...cur1, monitor: on };
        syncPrimaryProgramBusGains();
      },
      setSecondaryRouteMaster: (on: boolean) => {
        cur2 = { ...cur2, master: on };
        rm2.gain.value = routeToMasterLinear(cur2);
        rmon2.gain.value = routeToMonitorLinear(cur2);
      },
      setSecondaryRouteMonitor: (on: boolean) => {
        cur2 = { ...cur2, monitor: on };
        rm2.gain.value = routeToMasterLinear(cur2);
        rmon2.gain.value = routeToMonitorLinear(cur2);
      },
      setPrimaryExcludeFromProgramBus: (on: boolean) => {
        primaryExcludeFromProgramBus = on;
        syncPrimaryProgramBusGains();
      },
    },
  };
}

export type PassThroughCaptureResult = {
  stream: MediaStream;
  monitorStream: MediaStream;
  dispose: () => void;
  setGainLinear: (n: number) => void;
  setRouteMaster: (on: boolean) => void;
  setRouteMonitor: (on: boolean) => void;
  setPrimaryExcludeFromProgramBus: (on: boolean) => void;
  primaryAnalyser: AnalyserNode;
};

export async function passThroughCaptureWithGain(
  stream: MediaStream,
  gainLinear = 1,
  options?: {
    monitorExcludePrimary?: boolean;
    route?: ChannelRoutePair;
    primaryExcludeFromProgramBus?: boolean;
  }
): Promise<PassThroughCaptureResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  let cur: ChannelRoutePair = { ...(options?.route ?? ROUTE_DEFAULT) };

  const masterDest = ctx.createMediaStreamDestination();
  const monitorDest = ctx.createMediaStreamDestination();
  applyMaxChannelWebAudioNodes(masterDest, monitorDest);

  const g = ctx.createGain();
  const a = ctx.createAnalyser();
  a.fftSize = 512;
  a.smoothingTimeConstant = 0.75;
  g.gain.value = HEADROOM * clampLinear(gainLinear);

  const rm = ctx.createGain();
  const rmon = ctx.createGain();
  let primaryExcludeFromProgramBus =
    options?.primaryExcludeFromProgramBus ?? false;
  const syncProgramBusGains = () => {
    if (primaryExcludeFromProgramBus) {
      rm.gain.value = 0;
      rmon.gain.value = 0;
    } else {
      rm.gain.value = routeToMasterLinear(cur);
      rmon.gain.value = routeToMonitorLinear(cur);
    }
  };
  syncProgramBusGains();

  const src = ctx.createMediaStreamSource(stream);
  applyMaxChannelWebAudioNodes(g, a, rm, rmon);
  src.connect(g);
  g.connect(a);
  g.connect(rm);
  rm.connect(masterDest);
  g.connect(rmon);
  rmon.connect(monitorDest);

  const dispose = () => {
    try {
      src.disconnect();
      g.disconnect();
      a.disconnect();
      rm.disconnect();
      rmon.disconnect();
      masterDest.disconnect();
      monitorDest.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    stream: masterDest.stream,
    monitorStream: monitorDest.stream,
    dispose,
    primaryAnalyser: a,
    setGainLinear: (n: number) => {
      g.gain.value = HEADROOM * clampLinear(n);
    },
    setRouteMaster: (on: boolean) => {
      cur = { ...cur, master: on };
      syncProgramBusGains();
    },
    setRouteMonitor: (on: boolean) => {
      cur = { ...cur, monitor: on };
      syncProgramBusGains();
    },
    setPrimaryExcludeFromProgramBus: (on: boolean) => {
      primaryExcludeFromProgramBus = on;
      syncProgramBusGains();
    },
  };
}

export type MixTripleGainControls = {
  setPrimaryLinear: (n: number) => void;
  setSecondaryLinear: (n: number) => void;
  setTertiaryLinear: (n: number) => void;
  setPrimaryRouteMaster: (on: boolean) => void;
  setPrimaryRouteMonitor: (on: boolean) => void;
  setSecondaryRouteMaster: (on: boolean) => void;
  setSecondaryRouteMonitor: (on: boolean) => void;
  setTertiaryRouteMaster: (on: boolean) => void;
  setTertiaryRouteMonitor: (on: boolean) => void;
  setPrimaryExcludeFromProgramBus: (on: boolean) => void;
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
    primaryExcludeFromProgramBus?: boolean;
    primaryRoute?: ChannelRoutePair;
    secondaryRoute?: ChannelRoutePair;
    tertiaryRoute?: ChannelRoutePair;
  }
): Promise<MixedCaptureTripleResult> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => undefined);
  let cur1: ChannelRoutePair = {
    ...(options?.primaryRoute ?? ROUTE_DEFAULT),
  };
  let cur2: ChannelRoutePair = {
    ...(options?.secondaryRoute ?? ROUTE_DEFAULT),
  };
  let cur3: ChannelRoutePair = {
    ...(options?.tertiaryRoute ?? ROUTE_DEFAULT),
  };

  const masterDest = ctx.createMediaStreamDestination();
  const monitorDest = ctx.createMediaStreamDestination();
  applyMaxChannelWebAudioNodes(masterDest, monitorDest);

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

  const rm1 = ctx.createGain();
  const rm2 = ctx.createGain();
  const rm3 = ctx.createGain();
  const rmon1 = ctx.createGain();
  const rmon2 = ctx.createGain();
  const rmon3 = ctx.createGain();
  rm2.gain.value = routeToMasterLinear(cur2);
  rm3.gain.value = routeToMasterLinear(cur3);
  rmon2.gain.value = routeToMonitorLinear(cur2);
  rmon3.gain.value = routeToMonitorLinear(cur3);
  let primaryExcludeFromProgramBus =
    options?.primaryExcludeFromProgramBus ?? false;
  const syncPrimaryProgramBusGains = () => {
    if (primaryExcludeFromProgramBus) {
      rm1.gain.value = 0;
      rmon1.gain.value = 0;
    } else {
      rm1.gain.value = routeToMasterLinear(cur1);
      rmon1.gain.value = routeToMonitorLinear(cur1);
    }
  };
  syncPrimaryProgramBusGains();

  const src1 = ctx.createMediaStreamSource(primary);
  const src2 = ctx.createMediaStreamSource(secondary);
  const src3 = ctx.createMediaStreamSource(tertiary);
  applyMaxChannelWebAudioNodes(
    g1,
    g2,
    g3,
    a1,
    a2,
    a3,
    rm1,
    rm2,
    rm3,
    rmon1,
    rmon2,
    rmon3
  );
  src1.connect(g1);
  src2.connect(g2);
  src3.connect(g3);
  g1.connect(a1);
  g2.connect(a2);
  g3.connect(a3);
  g1.connect(rm1);
  rm1.connect(masterDest);
  g2.connect(rm2);
  rm2.connect(masterDest);
  g3.connect(rm3);
  rm3.connect(masterDest);
  g1.connect(rmon1);
  rmon1.connect(monitorDest);
  g2.connect(rmon2);
  rmon2.connect(monitorDest);
  g3.connect(rmon3);
  rmon3.connect(monitorDest);

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
      rm1.disconnect();
      rm2.disconnect();
      rm3.disconnect();
      rmon1.disconnect();
      rmon2.disconnect();
      rmon3.disconnect();
      masterDest.disconnect();
      monitorDest.disconnect();
    } catch {
      /* ignore */
    }
    primary.getTracks().forEach((t) => t.stop());
    secondary.getTracks().forEach((t) => t.stop());
    tertiary.getTracks().forEach((t) => t.stop());
    safeCloseAudioContext(ctx);
  };
  return {
    mixedStream: masterDest.stream,
    monitorStream: monitorDest.stream,
    dispose,
    primaryAnalyser: a1,
    secondaryAnalyser: a2,
    tertiaryAnalyser: a3,
    controls: {
      setPrimaryLinear: (n: number) => {
        g1.gain.value = HEADROOM * clampLinear(n);
      },
      setSecondaryLinear: (n: number) => {
        g2.gain.value = HEADROOM * clampLinear(n);
      },
      setTertiaryLinear: (n: number) => {
        g3.gain.value = HEADROOM * clampLinear(n);
      },
      setPrimaryRouteMaster: (on: boolean) => {
        cur1 = { ...cur1, master: on };
        syncPrimaryProgramBusGains();
      },
      setPrimaryRouteMonitor: (on: boolean) => {
        cur1 = { ...cur1, monitor: on };
        syncPrimaryProgramBusGains();
      },
      setSecondaryRouteMaster: (on: boolean) => {
        cur2 = { ...cur2, master: on };
        rm2.gain.value = routeToMasterLinear(cur2);
        rmon2.gain.value = routeToMonitorLinear(cur2);
      },
      setSecondaryRouteMonitor: (on: boolean) => {
        cur2 = { ...cur2, monitor: on };
        rm2.gain.value = routeToMasterLinear(cur2);
        rmon2.gain.value = routeToMonitorLinear(cur2);
      },
      setTertiaryRouteMaster: (on: boolean) => {
        cur3 = { ...cur3, master: on };
        rm3.gain.value = routeToMasterLinear(cur3);
        rmon3.gain.value = routeToMonitorLinear(cur3);
      },
      setTertiaryRouteMonitor: (on: boolean) => {
        cur3 = { ...cur3, monitor: on };
        rm3.gain.value = routeToMasterLinear(cur3);
        rmon3.gain.value = routeToMonitorLinear(cur3);
      },
      setPrimaryExcludeFromProgramBus: (on: boolean) => {
        primaryExcludeFromProgramBus = on;
        syncPrimaryProgramBusGains();
      },
    },
  };
}
