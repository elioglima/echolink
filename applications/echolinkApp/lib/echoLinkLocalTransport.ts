const originFromEnv =
  typeof process !== "undefined" &&
  typeof process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN === "string" &&
  process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN.length > 0
    ? process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN
    : null;

export const ECHO_LINK_SERVICE_ORIGIN =
  originFromEnv ?? "http://127.0.0.1:8765";

export type EchoLinkListenMode = "tcp" | "unix";

export type EchoLinkElectronHttpPayload = {
  path: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

export type EchoLinkElectronHttpResult = {
  ok: boolean;
  status: number;
  body: string;
  encoding?: "utf8" | "base64";
};

export function effectiveEchoLinkServiceOrigin(): string {
  if (
    typeof window !== "undefined" &&
    typeof window.echolink?.serviceLocalOrigin === "string" &&
    window.echolink.serviceLocalOrigin.trim().length > 0
  ) {
    return window.echolink.serviceLocalOrigin.trim();
  }
  return ECHO_LINK_SERVICE_ORIGIN;
}

function buildEchoLinkWebSocketUrl(path: string): string {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  let u: URL;
  try {
    u = new URL(effectiveEchoLinkServiceOrigin());
  } catch {
    u = new URL("http://127.0.0.1:8765");
  }
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}${pathname}`;
}

export function getEchoLinkMicWebSocketUrl(): string {
  return buildEchoLinkWebSocketUrl("/ws/mic");
}

export function getEchoLinkSttWebSocketUrl(phraseSilenceCutMs?: number): string {
  const base = buildEchoLinkWebSocketUrl("/ws/stt");
  if (phraseSilenceCutMs === undefined) {
    return base;
  }
  try {
    const u = new URL(base);
    u.searchParams.set(
      "phraseSilenceCutMs",
      String(Math.round(phraseSilenceCutMs))
    );
    return u.toString();
  } catch {
    return base;
  }
}

export function openEchoLinkServiceWebSocket(path: string): WebSocket {
  return new WebSocket(buildEchoLinkWebSocketUrl(path));
}

export function echoLinkServiceOriginForDisplay(): string {
  try {
    return new URL(effectiveEchoLinkServiceOrigin()).host;
  } catch {
    return "127.0.0.1:8765";
  }
}

export function echoLinkNamedPipePathFromEnv(): string | undefined {
  if (typeof process === "undefined" || !process.env) {
    return undefined;
  }
  const p = process.env.ECHO_LINK_NAMED_PIPE?.trim();
  return p || undefined;
}

export function echoLinkUsesElectronHttpBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.echolink?.httpFetch === "function"
  );
}

export async function fetchEchoLinkService(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = effectiveEchoLinkServiceOrigin();
  const method = (init?.method ?? "GET").toUpperCase();
  const headerMap: Record<string, string> = {};
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => {
      headerMap[k] = v;
    });
  }
  let bodyStr: string | undefined;
  if (typeof init?.body === "string") {
    bodyStr = init.body;
  }
  const useIpcHttp =
    echoLinkUsesElectronHttpBridge() &&
    typeof window !== "undefined" &&
    !window.echolink?.serviceLocalOrigin?.trim();
  if (useIpcHttp) {
    const r = await window.echolink!.httpFetch!({
      path: normalized,
      method,
      body: bodyStr,
      headers: headerMap,
    });
    const enc = r.encoding ?? "utf8";
    if (enc === "base64") {
      const binary = atob(r.body);
      const len = binary.length;
      const u8 = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        u8[i] = binary.charCodeAt(i);
      }
      return new Response(u8.buffer, { status: r.status });
    }
    return new Response(r.body, { status: r.status });
  }
  return fetch(`${base}${normalized}`, init);
}
