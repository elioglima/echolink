"use client";

import dynamic from "next/dynamic";

const MicCapture = dynamic(
  () =>
    import("../components/micCapture").then((mod) => ({
      default: mod.MicCapture,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex min-h-0 flex-1 flex-col items-center justify-center bg-zinc-900 px-4"
        aria-busy="true"
        aria-live="polite"
      >
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">
          Carregando painel…
        </p>
      </div>
    ),
  }
);

export function HomePanel() {
  return <MicCapture />;
}
