export function findEchoLinkVirtualOutputDeviceId(
  devices: MediaDeviceInfo[]
): string | null {
  for (const d of devices) {
    const label = (d.label || "").toLowerCase();
    if (label.includes("echolink") && label.includes("virtual")) {
      return d.deviceId;
    }
  }
  return null;
}
