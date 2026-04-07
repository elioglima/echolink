"use client";

import {
  memo,
  type DragEvent,
} from "react";

import type { EchoLinkMixerStripId } from "../lib/echoLinkSettings";

export const MIX_FADER_MAX = 150;

export const MemoMixerFaderRange = memo(function MemoMixerFaderRange({
  domId,
  name,
  ariaLabel,
  faderValue,
  onFaderChange,
  faderMax = MIX_FADER_MAX,
}: {
  domId: string;
  name: string;
  ariaLabel: string;
  faderValue: number;
  onFaderChange: (v: number) => void;
  faderMax?: number;
}) {
  return (
    <input
      id={domId}
      name={name}
      type="range"
      min={0}
      max={faderMax}
      step={1}
      value={faderValue}
      onChange={(e) => onFaderChange(Number.parseInt(e.target.value, 10))}
      className="app-region-no-drag echo-mixer-fader-input echo-console-fader touch-manipulation"
      aria-label={ariaLabel}
    />
  );
});

export function formatMixFaderDbLabel(percent: number): string {
  if (percent <= 0) return "−∞";
  const db = 20 * Math.log10(percent / 100);
  if (db > 9) return "+10";
  if (db >= -0.35 && db <= 0.35) return "0";
  const rounded = Math.round(db);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

export const MIXER_TOOLBAR_ICON_CLASS =
  "pointer-events-none mx-auto block h-8 w-8 shrink-0 sm:h-10 sm:w-10";

export function IconMixerPower({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </svg>
  );
}

export function IconMixerSettings({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconMixerTranslation({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m5 8 6 6" />
      <path d="m4 14 6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="m22 22-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  );
}

export function IconMixerVolumeOn({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

export function IconMixerVolumeMuted({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="22" x2="16" y1="9" y2="15" />
      <line x1="16" x2="22" y1="9" y2="15" />
    </svg>
  );
}

export function MixerFaderDbScale({
  level,
  className = "",
  trackClassName = "bg-black",
}: {
  level: number;
  className?: string;
  trackClassName?: string;
}) {
  const pct = Math.min(100, Math.max(0, level * 100));
  const labelClass =
    "relative z-10 w-full text-center font-mono text-[10px] font-medium leading-none text-zinc-200 drop-shadow-[0_1px_2px_rgba(0,0,0,1)] sm:text-[11px]";
  return (
    <div
      className={`relative h-full min-h-0 overflow-hidden ${trackClassName} ${className}`}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Nível de áudio na escala em dB"
    >
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 opacity-[0.92] transition-[height] duration-75 ease-out bg-linear-to-t from-emerald-600/80 via-amber-400/65 to-red-500/55"
        style={{ height: `${pct}%` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-1 opacity-35"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to top, transparent 0px, transparent 5px, rgba(0,0,0,0.45) 5px, rgba(0,0,0,0.45) 6px)",
        }}
        aria-hidden
      />
      <div className="relative z-2 flex h-full flex-col justify-between py-2 sm:py-2.5">
        <span className={labelClass}>+10</span>
        <span className={labelClass}>0</span>
        <span className={labelClass}>−10</span>
        <span className={labelClass}>−20</span>
        <span className={labelClass}>−30</span>
        <span className={labelClass}>−40</span>
        <span className={labelClass}>−60</span>
        <span
          className={`${labelClass} text-[9px] text-zinc-400 sm:text-[10px]`}
        >
          −∞
        </span>
      </div>
    </div>
  );
}

export function mixerChannelStripBorderColorClass(
  role: "input" | "output" | "monitor",
  activateOn: boolean,
  muted: boolean,
  faderDisabled?: boolean
): string {
  const pathOff = !activateOn || Boolean(faderDisabled);
  if (muted) {
    return "border-red-500";
  }
  if (role === "output") {
    return pathOff ? "border-violet-700/75" : "border-violet-500";
  }
  if (role === "monitor") {
    return pathOff ? "border-sky-700/80" : "border-sky-400/95";
  }
  if (pathOff) {
    return "border-amber-400";
  }
  return "border-emerald-500";
}

export function mixerChannelStripBadgeToneClassName(
  role: "input" | "output" | "monitor",
  activateOn: boolean,
  muted: boolean,
  faderDisabled?: boolean
): string {
  const pathOff = !activateOn || Boolean(faderDisabled);
  if (muted) {
    return "bg-red-600 text-white";
  }
  if (role === "output") {
    return pathOff
      ? "bg-violet-800/92 text-violet-50 ring-1 ring-violet-600/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
      : "bg-violet-500 text-white ring-1 ring-violet-400/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]";
  }
  if (role === "monitor") {
    return pathOff
      ? "bg-sky-900/92 text-sky-50 ring-1 ring-sky-700/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
      : "bg-sky-400 text-zinc-900 ring-1 ring-sky-500/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.38)]";
  }
  if (pathOff) {
    return "bg-amber-400 text-black";
  }
  return "bg-emerald-500 text-black";
}

export const MIXER_STRIP_BOTTOM_BADGE_LAYOUT_CLASS =
  "mb-[5px] flex w-full min-h-[2.75rem] shrink-0 items-center justify-center rounded-md px-2 py-1 text-center font-mono text-[12px] font-bold uppercase leading-tight tracking-[0.2em] sm:min-h-[2.875rem] sm:text-[13px] sm:tracking-[0.22em]";

export const MIXER_STRIP_DND_TYPE = "application/x-echolink-mixer-strip";

export function MixerChannelRoutePairButtons({
  channelId,
  routeToMaster,
  routeToMonitor,
  routeMonitorLocked,
  masterDisabled,
  monitorDisabled,
  onRouteMasterToggle,
  onRouteMonitorToggle,
  wrapperClassName = "",
}: {
  channelId: 1 | 2 | 3;
  routeToMaster: boolean;
  routeToMonitor: boolean;
  routeMonitorLocked: boolean;
  masterDisabled: boolean;
  monitorDisabled: boolean;
  onRouteMasterToggle: () => void;
  onRouteMonitorToggle: () => void;
  wrapperClassName?: string;
}) {
  return (
    <div className={`w-full min-w-0 shrink-0 ${wrapperClassName}`}>
      <div
        className="flex min-h-0 w-full min-w-0 overflow-hidden rounded-md border border-sky-900/55 bg-sky-950/40 shadow-[inset_0_1px_0_rgba(125,211,252,0.07)]"
        role="group"
        aria-label={`Rotas Master e Retorno — canal ${channelId}`}
      >
        <button
          type="button"
          disabled={masterDisabled}
          onClick={onRouteMasterToggle}
          title="Saída Master (captura / STT)"
          aria-label={`Master — canal ${channelId}`}
          aria-pressed={routeToMaster}
          className={`flex min-h-[2.5rem] flex-1 min-w-0 items-center justify-center border-0 px-1 py-0.5 text-center font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.14em] transition outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 sm:min-h-[2.625rem] sm:px-1.5 sm:text-[11px] sm:tracking-[0.16em] ${
            routeToMaster
              ? "bg-violet-500 text-white shadow-[inset_0_0_12px_rgba(139,92,246,0.45)]"
              : "bg-violet-950/65 text-violet-200/95"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          MASTER
        </button>
        <button
          type="button"
          disabled={monitorDisabled}
          onClick={onRouteMonitorToggle}
          title={
            routeMonitorLocked
              ? "Retorno indisponível para o microfone com tradução de voz ativa"
              : "Saída Retorno (monitor)"
          }
          aria-label={`Retorno — canal ${channelId}`}
          aria-pressed={routeMonitorLocked ? false : routeToMonitor}
          className={`flex min-h-[2.5rem] flex-1 min-w-0 items-center justify-center border-0 border-l border-sky-600/50 px-1 py-0.5 text-center font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.14em] transition outline-none focus-visible:ring-2 focus-visible:ring-sky-400/45 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 sm:min-h-[2.625rem] sm:px-1.5 sm:text-[11px] sm:tracking-[0.16em] ${
            routeMonitorLocked
              ? "bg-sky-900/85 text-sky-200/75"
              : routeToMonitor
                ? "bg-sky-500 text-black shadow-[inset_0_0_12px_rgba(14,165,233,0.45)]"
                : "bg-sky-800/75 text-sky-100/95"
          } disabled:cursor-not-allowed disabled:opacity-35`}
        >
          MONITOR
        </button>
      </div>
    </div>
  );
}

export function moveMixerStripInOrder(
  order: EchoLinkMixerStripId[],
  fromId: EchoLinkMixerStripId,
  toId: EchoLinkMixerStripId
): EchoLinkMixerStripId[] {
  if (fromId === toId) {
    return order;
  }
  const next = order.filter((x) => x !== fromId);
  const i = next.indexOf(toId);
  if (i < 0) {
    return order;
  }
  next.splice(i, 0, fromId);
  return next;
}

export function MixerStripTopDragHandle({
  stripId,
  draggingStripId,
  onDragStart,
  onDragEnd,
}: {
  stripId: EchoLinkMixerStripId;
  draggingStripId: EchoLinkMixerStripId | null;
  onDragStart: (id: EchoLinkMixerStripId) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className="mb-1.5 flex shrink-0 cursor-grab justify-center px-1 pt-0.5 active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MIXER_STRIP_DND_TYPE, stripId);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(stripId);
      }}
      onDragEnd={onDragEnd}
      title="Arrastar para reordenar as faixas"
      aria-label="Arrastar para reordenar as faixas do mixer"
    >
      <div
        className={`h-1.5 w-10 shrink-0 rounded-full sm:h-2 sm:w-12 ${
          draggingStripId === stripId ? "bg-zinc-400" : "bg-zinc-500/75"
        }`}
      />
    </div>
  );
}

export type MixerStripDnDProps = {
  mixerStripId: EchoLinkMixerStripId;
  stripStackIndex: number;
  draggingMixerStripId: EchoLinkMixerStripId | null;
  onMixerStripDragStart: (id: EchoLinkMixerStripId) => void;
  onMixerStripDragEnd: () => void;
  onMixerStripDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onMixerStripDrop: (
    e: DragEvent<HTMLDivElement>,
    targetId: EchoLinkMixerStripId
  ) => void;
};
