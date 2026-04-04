export function isElectronRenderer(): boolean {
  if (typeof window === "undefined") return false;
  return window.echolink?.isElectron === true;
}
