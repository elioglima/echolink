import {
  parseEchoLinkSettingsFromServer,
  type EchoLinkSettings,
} from "./echoLinkSettings";

const originFromEnv =
  typeof process !== "undefined" &&
  typeof process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN === "string" &&
  process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN.length > 0
    ? process.env.NEXT_PUBLIC_ECHO_LINK_SERVICE_ORIGIN
    : null;

const ECHO_LINK_SERVICE_ORIGIN = originFromEnv ?? "http://127.0.0.1:8765";

export async function hydrateEchoLinkSettingsFromServer(): Promise<EchoLinkSettings | null> {
  try {
    const res = await fetch(`${ECHO_LINK_SERVICE_ORIGIN}/config`, {
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
  try {
    const res = await fetch(`${ECHO_LINK_SERVICE_ORIGIN}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
    if (!res.ok) return;
  } catch {
    return;
  }
}
