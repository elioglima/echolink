import { fetchEchoLinkService } from "./echoLinkLocalTransport";

export async function postEchoLinkRuntimeCapture(active: boolean): Promise<void> {
  try {
    await fetchEchoLinkService("/runtime/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureActive: active }),
    });
  } catch {
    return;
  }
}
