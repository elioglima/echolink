export type AudioPipelineInjectResult = {
  disconnect: () => void;
};

export type AudioPipelineInject = (
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  gainNode: GainNode
) => AudioPipelineInjectResult;

export function defaultPipelineInject(
  _context: AudioContext,
  source: MediaStreamAudioSourceNode,
  gainNode: GainNode
): AudioPipelineInjectResult {
  source.connect(gainNode);
  return {
    disconnect: () => {
      try {
        source.disconnect(gainNode);
      } catch {
        /* ignore */
      }
    },
  };
}

export type ConnectMonitorBranchOptions = {
  monitorGain: number;
  outputDeviceId?: string;
  inject?: AudioPipelineInject;
};

type AudioContextWithSink = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
};

type HtmlAudioWithSink = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

export async function connectMonitorBranch(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  options: ConnectMonitorBranchOptions
): Promise<{
  gainNode: GainNode;
  outputAnalyser: AnalyserNode;
  disconnect: () => void;
}> {
  await context.resume().catch(() => undefined);

  const injectFn = options.inject ?? defaultPipelineInject;
  const gainNode = context.createGain();
  gainNode.gain.value = options.monitorGain;
  const injectResult = injectFn(context, source, gainNode);
  const injectCleanup = injectResult.disconnect;
  const outputAnalyser = context.createAnalyser();
  outputAnalyser.fftSize = 512;
  outputAnalyser.smoothingTimeConstant = 0.75;
  gainNode.connect(outputAnalyser);

  const sinkId = options.outputDeviceId?.trim() ?? "";
  const ctxTyped = context as AudioContextWithSink;

  let monitorEl: HTMLAudioElement | null = null;
  let monitorDest: MediaStreamAudioDestinationNode | null = null;

  if (sinkId) {
    let routedViaContext = false;
    if (typeof ctxTyped.setSinkId === "function") {
      try {
        await ctxTyped.setSinkId(sinkId);
        outputAnalyser.connect(context.destination);
        routedViaContext = true;
      } catch {
        routedViaContext = false;
      }
    }
    if (!routedViaContext) {
      monitorDest = context.createMediaStreamDestination();
      outputAnalyser.connect(monitorDest);
      monitorEl = new Audio();
      monitorEl.playsInline = true;
      monitorEl.srcObject = monitorDest.stream;
      const elTyped = monitorEl as HtmlAudioWithSink;
      if (typeof elTyped.setSinkId === "function") {
        try {
          await elTyped.setSinkId(sinkId);
        } catch {
          /* fall back to default sink */
        }
      }
      await monitorEl.play().catch(() => undefined);
    }
  } else {
    outputAnalyser.connect(context.destination);
  }

  const disconnect = () => {
    injectCleanup();
    try {
      gainNode.disconnect();
    } catch {
      /* ignore */
    }
    try {
      outputAnalyser.disconnect();
    } catch {
      /* ignore */
    }
    if (monitorEl) {
      try {
        monitorEl.pause();
      } catch {
        /* ignore */
      }
      monitorEl.srcObject = null;
      monitorEl = null;
    }
    monitorDest = null;
  };

  return { gainNode, outputAnalyser, disconnect };
}
