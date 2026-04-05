export const ECHO_LINK_CAPTURE_CHANNEL_COUNT_IDEAL = 8;

export const ECHO_LINK_WEB_AUDIO_MAX_CHANNELS = 8;

export function withIdealMultiChannelCapture(
  constraints: MediaTrackConstraints
): MediaTrackConstraints {
  if (constraints.channelCount !== undefined) {
    return constraints;
  }
  return {
    ...constraints,
    channelCount: { ideal: ECHO_LINK_CAPTURE_CHANNEL_COUNT_IDEAL },
  };
}

export function applyMaxChannelWebAudioNodes(...nodes: AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.channelCount = ECHO_LINK_WEB_AUDIO_MAX_CHANNELS;
      n.channelCountMode = "max";
    } catch {
      /* ignore */
    }
  }
}
