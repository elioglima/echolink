import { fetchEchoLinkService } from "./echoLinkLocalTransport";
import {
  parseEchoLinkSettingsFromServer,
  type EchoLinkSettings,
} from "./echoLinkSettings";

const SERVER_CONFIG_PATCH_DEBOUNCE_MS = 220;
let serverConfigPatchPending: Partial<EchoLinkSettings> | null = null;
let serverConfigPatchTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleServerConfigPatchFlush() {
  if (serverConfigPatchTimer !== null) {
    clearTimeout(serverConfigPatchTimer);
  }
  serverConfigPatchTimer = setTimeout(() => {
    serverConfigPatchTimer = null;
    void flushEchoLinkServerConfigPatch();
  }, SERVER_CONFIG_PATCH_DEBOUNCE_MS);
}

async function flushEchoLinkServerConfigPatch(): Promise<void> {
  const body = serverConfigPatchPending;
  serverConfigPatchPending = null;
  if (!body || Object.keys(body).length === 0) {
    return;
  }
  try {
    const res = await fetchEchoLinkService("/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
  } catch {
    return;
  }
}

export async function hydrateEchoLinkSettingsFromServer(): Promise<EchoLinkSettings | null> {
  try {
    const res = await fetchEchoLinkService("/config", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    return parseEchoLinkSettingsFromServer(data);
  } catch {
    return null;
  }
}

export async function pushEchoLinkServerConfigPatch(
  partial: Partial<EchoLinkSettings>
): Promise<void> {
  if (Object.keys(partial).length === 0) {
    return;
  }
  serverConfigPatchPending = {
    ...serverConfigPatchPending,
    ...partial,
  };
  scheduleServerConfigPatchFlush();
}
