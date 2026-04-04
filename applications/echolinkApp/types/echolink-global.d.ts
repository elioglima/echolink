import type { EchoLinkSettings } from "../lib/echoLinkSettings";

declare global {
  interface Window {
    echolink?: {
      isElectron?: boolean;
      readSettings: () => Promise<unknown>;
      writeSettings: (data: EchoLinkSettings) => Promise<void>;
      openExternal?: (url: string) => Promise<void>;
    };
  }
}

export {};
