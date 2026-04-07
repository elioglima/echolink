import { fetchEchoLinkService } from "./echoLinkLocalTransport";

export type EchoLinkRuntimeSnapshot = {
  status?: string;
  panelCaptureActive?: boolean;
  panelCaptureStartedAt?: string | null;
  panelCaptureStoppedAt?: string | null;
  activeWebSockets?: { mic?: number; stt?: number };
  updatedAt?: string;
};

export async function fetchEchoLinkRuntimeSnapshot(): Promise<EchoLinkRuntimeSnapshot | null> {
  try {
    const res = await fetchEchoLinkService("/runtime");
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as EchoLinkRuntimeSnapshot;
    return data;
  } catch {
    return null;
  }
}

export async function postEchoLinkRuntimeCapture(active: boolean): Promise<boolean> {
  try {
    const res = await fetchEchoLinkService("/runtime/capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureActive: active }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
