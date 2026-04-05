export function safeCloseAudioContext(
  ctx: AudioContext | null | undefined
): void {
  if (!ctx || ctx.state === "closed") {
    return;
  }
  void ctx.close().catch(() => undefined);
}
