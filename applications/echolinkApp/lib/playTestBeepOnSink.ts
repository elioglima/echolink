type AudioContextWithSink = AudioContext & {
  setSinkId?: (id: string) => Promise<void>;
};

type HtmlAudioWithSink = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

export async function playTestBeepOnSink(outputDeviceId: string): Promise<void> {
  const durationSec = 0.35;
  const sinkId = outputDeviceId.trim();
  const ctx = new AudioContext();
  try {
    await ctx.resume().catch(() => undefined);
    const ctxTyped = ctx as AudioContextWithSink;
    let useDirectDestination = !sinkId;
    if (sinkId && typeof ctxTyped.setSinkId === "function") {
      try {
        await ctxTyped.setSinkId(sinkId);
        useDirectDestination = true;
      } catch {
        useDirectDestination = false;
      }
    }
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.14;
    osc.type = "sine";
    osc.frequency.value = 440;
    osc.connect(g);
    if (useDirectDestination) {
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationSec);
      await new Promise((r) => setTimeout(r, durationSec * 1000 + 120));
      return;
    }
    const dest = ctx.createMediaStreamDestination();
    g.connect(dest);
    const monitorEl = new Audio();
    monitorEl.playsInline = true;
    monitorEl.srcObject = dest.stream;
    const el = monitorEl as HtmlAudioWithSink;
    if (sinkId && typeof el.setSinkId === "function") {
      try {
        await el.setSinkId(sinkId);
      } catch {
        /* default sink */
      }
    }
    await monitorEl.play().catch(() => undefined);
    osc.start();
    osc.stop(ctx.currentTime + durationSec);
    await new Promise((r) => setTimeout(r, durationSec * 1000 + 120));
    try {
      monitorEl.pause();
    } catch {
      /* ignore */
    }
    monitorEl.srcObject = null;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
