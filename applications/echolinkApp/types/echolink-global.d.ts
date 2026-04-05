import type { EchoLinkSettings } from "../lib/echoLinkSettings";
import type {
  EchoLinkElectronHttpPayload,
  EchoLinkElectronHttpResult,
} from "../lib/echoLinkLocalTransport";

declare global {
  interface Window {
    echolink?: {
      isElectron?: boolean;
      serviceLocalOrigin?: string;
      readSettings: () => Promise<unknown>;
      writeSettings: (data: EchoLinkSettings) => Promise<void>;
      openExternal?: (url: string) => Promise<void>;
      httpFetch?: (
        payload: EchoLinkElectronHttpPayload
      ) => Promise<EchoLinkElectronHttpResult>;
    };
  }
}

export {};
