const originFromEnv =
  typeof process !== "undefined" &&
  typeof process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN === "string" &&
  process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN.length > 0
    ? process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN
    : null;

const ECHO_LINK_SERVICE_ORIGIN = originFromEnv ?? "http://127.0.0.1:8765";

export async function postEchoLinkRuntimeCapture(active: boolean): Promise<void> {
  try {
    await fetch(`${ECHO_LINK_SERVICE_ORIGIN}/runtime/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureActive: active }),
    });
  } catch {
    return;
  }
}
