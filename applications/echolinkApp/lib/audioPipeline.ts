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

export async function connectMonitorBranch(
  context: AudioContext,
  source: MediaStreamAudioSourceNode,
  options: ConnectMonitorBranchOptions
): Promise<{
  gainNode: GainNode;
  outputAnalyser: AnalyserNode;
  disconnect: () => void;
}> {
  const withSink = context as AudioContext & {
    setSinkId?: (id: string) => Promise<void>;
  };
  if (options.outputDeviceId && typeof withSink.setSinkId === "function") {
    await withSink.setSinkId(options.outputDeviceId);
  }
  const injectFn = options.inject ?? defaultPipelineInject;
  const gainNode = context.createGain();
  gainNode.gain.value = options.monitorGain;
  const injectResult = injectFn(context, source, gainNode);
  const injectCleanup = injectResult.disconnect;
  const outputAnalyser = context.createAnalyser();
  outputAnalyser.fftSize = 512;
  outputAnalyser.smoothingTimeConstant = 0.75;
  gainNode.connect(outputAnalyser);
  outputAnalyser.connect(context.destination);
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
  };
  return { gainNode, outputAnalyser, disconnect };
}
