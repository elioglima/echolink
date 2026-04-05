export function formatMediaDeviceOptionLabel(
  d: MediaDeviceInfo,
  kind: "input" | "output",
  friendlyAlias?: string
): string {
  const idTail = d.deviceId.length >= 6 ? d.deviceId.slice(-6) : d.deviceId;
  const trimmed = friendlyAlias?.trim();
  if (trimmed) {
    return `${trimmed} · ${idTail}`;
  }
  const base =
    d.label?.trim() ||
    (kind === "input"
      ? `Entrada (${d.deviceId.slice(0, 10)}…)`
      : `Saída (${d.deviceId.slice(0, 10)}…)`);
  return `${base} · ${idTail}`;
}
