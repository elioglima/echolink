const originFromEnv =
  typeof process !== "undefined" &&
  typeof process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN === "string" &&
  process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN.length > 0
    ? process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN
    : null;

const ECHO_LINK_SERVICE_ORIGIN = originFromEnv ?? "http://127.0.0.1:8765";

export type EchoLinkChatSessionListItem = {
  sessionId: string;
  fileName: string;
  messageCount: number;
  startedAt?: string;
  endedAt?: string | null;
};

export type EchoLinkChatSessionDetail = {
  schemaVersion?: number;
  sessionId?: string;
  startedAt?: string;
  endedAt?: string | null;
  interimPt?: string | null;
  messages: Record<string, unknown>[];
};

function parseListItem(raw: unknown): EchoLinkChatSessionListItem | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const sessionId =
    typeof rec.sessionId === "string" ? rec.sessionId.trim() : "";
  const fileName = typeof rec.fileName === "string" ? rec.fileName.trim() : "";
  if (!sessionId || !fileName) {
    return null;
  }
  const messageCount =
    typeof rec.messageCount === "number" && Number.isFinite(rec.messageCount)
      ? Math.max(0, Math.floor(rec.messageCount))
      : 0;
  return {
    sessionId,
    fileName,
    messageCount,
    startedAt:
      typeof rec.startedAt === "string" ? rec.startedAt : undefined,
    endedAt:
      rec.endedAt === null || typeof rec.endedAt === "string"
        ? rec.endedAt
        : undefined,
  };
}

export async function fetchEchoLinkChatSessions(): Promise<
  EchoLinkChatSessionListItem[]
> {
  try {
    const res = await fetch(`${ECHO_LINK_SERVICE_ORIGIN}/chats/sessions`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return [];
    }
    const j = (await res.json()) as unknown;
    if (!Array.isArray(j)) {
      return [];
    }
    const out: EchoLinkChatSessionListItem[] = [];
    for (const item of j) {
      const row = parseListItem(item);
      if (row) {
        out.push(row);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchEchoLinkChatSession(
  sessionId: string
): Promise<EchoLinkChatSessionDetail | null> {
  const id = sessionId.trim();
  if (!id) {
    return null;
  }
  try {
    const res = await fetch(
      `${ECHO_LINK_SERVICE_ORIGIN}/chats/sessions/${encodeURIComponent(id)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return null;
    }
    const j = (await res.json()) as unknown;
    if (j === null || typeof j !== "object") {
      return null;
    }
    const rec = j as Record<string, unknown>;
    const rawMessages = rec.messages;
    const messages = Array.isArray(rawMessages)
      ? rawMessages.filter(
          (x): x is Record<string, unknown> =>
            x !== null && typeof x === "object" && !Array.isArray(x)
        )
      : [];
    return {
      schemaVersion:
        typeof rec.schemaVersion === "number" ? rec.schemaVersion : undefined,
      sessionId:
        typeof rec.sessionId === "string" ? rec.sessionId : undefined,
      startedAt:
        typeof rec.startedAt === "string" ? rec.startedAt : undefined,
      endedAt:
        rec.endedAt === null || typeof rec.endedAt === "string"
          ? rec.endedAt
          : undefined,
      interimPt:
        rec.interimPt === null || typeof rec.interimPt === "string"
          ? rec.interimPt
          : undefined,
      messages,
    };
  } catch {
    return null;
  }
}
