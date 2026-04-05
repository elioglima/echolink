import { fetchEchoLinkService } from "./echoLinkLocalTransport";

export type EchoLinkChatSessionStart = {
  sessionId: string;
  relativePath: string;
};

export async function postEchoLinkChatSession(): Promise<EchoLinkChatSessionStart | null> {
  try {
    const res = await fetchEchoLinkService("/chats/sessions", {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const j = (await res.json()) as unknown;
    if (j === null || typeof j !== "object") {
      return null;
    }
    const rec = j as Record<string, unknown>;
    const sessionId =
      typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
    const relativePath =
      typeof rec.relativePath === "string" ? rec.relativePath.trim() : "";
    if (!sessionId) {
      return null;
    }
    return { sessionId, relativePath };
  } catch {
    return null;
  }
}

export async function putEchoLinkChatSessionSnapshot(
  sessionId: string,
  payload: {
    messages: unknown[];
    interimPt?: string | null;
    ended?: boolean;
  }
): Promise<void> {
  try {
    await fetchEchoLinkService(
      `/chats/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          messages: payload.messages,
          interimPt: payload.interimPt ?? null,
          ended: payload.ended ?? false,
        }),
      }
    );
  } catch {
    return;
  }
}
