export type EchoLinkChatSpeaker = "self" | "other";

export type EchoLinkChatAppendPayload = {
  speaker: EchoLinkChatSpeaker;
  pt: string;
};

const EVT = "echoLinkChatAppend";

export function appendEchoLinkChatMessage(
  payload: EchoLinkChatAppendPayload
): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(EVT, { detail: payload }));
}

export function subscribeEchoLinkChatAppend(
  fn: (payload: EchoLinkChatAppendPayload) => void
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handler = (ev: Event) => {
    const ce = ev as CustomEvent<EchoLinkChatAppendPayload>;
    const d = ce.detail;
    if (
      d &&
      typeof d.pt === "string" &&
      (d.speaker === "self" || d.speaker === "other")
    ) {
      fn(d);
    }
  };
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
