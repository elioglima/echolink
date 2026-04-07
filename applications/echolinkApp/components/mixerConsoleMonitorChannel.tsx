"use client";

import {
  IconMixerPower,
  IconMixerSettings,
  IconMixerVolumeMuted,
  IconMixerVolumeOn,
  MemoMixerFaderRange,
  mixerChannelStripBadgeToneClassName,
  mixerChannelStripBorderColorClass,
  MIXER_STRIP_BOTTOM_BADGE_LAYOUT_CLASS,
  MixerFaderDbScale,
  MixerStripTopDragHandle,
  MIXER_TOOLBAR_ICON_CLASS,
  type MixerStripDnDProps,
} from "./mixerConsoleShared";

export type MixerConsoleMonitorChannelProps = {
  activateOn: boolean;
  onActivateToggle: () => void;
  onEdit: () => void;
  muted: boolean;
  onMuteToggle: () => void;
  deviceLabel: string;
  vuLevel: number;
  faderValue: number;
  onFaderChange: (v: number) => void;
  faderDisabled: boolean;
  busy: boolean;
  activateDisabled: boolean;
} & MixerStripDnDProps;

export function MixerConsoleMonitorChannel({
  activateOn,
  onActivateToggle,
  onEdit,
  muted,
  onMuteToggle,
  deviceLabel,
  vuLevel,
  faderValue,
  onFaderChange,
  faderDisabled,
  busy,
  activateDisabled,
  mixerStripId,
  stripStackIndex,
  draggingMixerStripId,
  onMixerStripDragStart,
  onMixerStripDragEnd,
  onMixerStripDragOver,
  onMixerStripDrop,
}: MixerConsoleMonitorChannelProps) {
  const mixerIconHit =
    "inline-flex w-full min-h-11 items-center justify-center rounded-md border-0 bg-transparent py-1.5 outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-12 sm:py-2";
  const vuLevelShown =
    activateOn && !muted && !faderDisabled ? vuLevel : 0;
  const stripDim =
    !activateOn ? "opacity-40" : muted ? "opacity-55" : "";
  const faderZoneMutedVisual =
    faderDisabled && activateOn ? "opacity-[0.55]" : "";
  const faderDomId = "echo-mixer-fader-monitor";
  return (
    <div
      className={`relative isolate box-border flex min-h-0 w-[11.5rem] shrink-0 flex-col overflow-hidden border-l-2 border-solid bg-linear-to-b from-sky-800/40 via-blue-900/35 to-transparent px-2.5 pb-0 pt-2 shadow-[inset_0_1px_0_rgba(96,165,250,0.14)] sm:w-[13.25rem] sm:px-3 ${mixerChannelStripBorderColorClass("monitor", activateOn, muted, faderDisabled)} ${draggingMixerStripId === mixerStripId ? "opacity-50" : ""}`}
      style={{ zIndex: stripStackIndex + 1 }}
      onDragOver={onMixerStripDragOver}
      onDrop={(e) => onMixerStripDrop(e, mixerStripId)}
    >
      <MixerStripTopDragHandle
        stripId={mixerStripId}
        draggingStripId={draggingMixerStripId}
        onDragStart={onMixerStripDragStart}
        onDragEnd={onMixerStripDragEnd}
      />
      <p className="mt-[8px] mb-[8px] shrink-0 border-0 bg-transparent px-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300/90 shadow-none ring-0 outline-none sm:text-[11px] sm:tracking-[0.22em]">
        MONITOR
      </p>
      <div className="mb-1.5 flex min-w-0 shrink-0 flex-col gap-2">
        <button
          type="button"
          disabled={busy || activateDisabled}
          onClick={onActivateToggle}
          title={
            activateOn
              ? "Desativar escuta do monitor"
              : "Ativar escuta do monitor"
          }
          aria-label={
            activateOn
              ? "Desativar escuta do pipeline no dispositivo de saída"
              : "Ativar escuta do pipeline no dispositivo de saída"
          }
          className={`${mixerIconHit} ${
            activateOn
              ? "text-sky-300 drop-shadow-[0_0_14px_rgba(96,165,250,0.55)]"
              : "text-zinc-200"
          }`}
        >
          <IconMixerPower className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onEdit}
          title="Editar monitoramento (mesa)"
          aria-label="Editar definições de monitoramento na mesa"
          className={`${mixerIconHit} ${
            activateOn ? "text-sky-300" : "text-zinc-500"
          }`}
        >
          <IconMixerSettings className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onMuteToggle}
          title={
            muted && activateOn
              ? "Restaurar som do monitor"
              : "Silenciar saída do monitor"
          }
          aria-label={
            muted && activateOn
              ? "Restaurar som do monitor"
              : "Silenciar saída do monitor"
          }
          className={`${mixerIconHit} ${
            muted && activateOn
              ? "text-red-400 drop-shadow-[0_0_12px_rgba(248,113,113,0.45)]"
              : "text-zinc-400"
          }`}
        >
          {muted && activateOn ? (
            <IconMixerVolumeMuted className={MIXER_TOOLBAR_ICON_CLASS} />
          ) : (
            <IconMixerVolumeOn className={MIXER_TOOLBAR_ICON_CLASS} />
          )}
        </button>
      </div>
      <p className="mb-1 line-clamp-2 min-h-8 shrink-0 text-center text-[8px] leading-snug text-white sm:text-[9px]">
        {deviceLabel}
      </p>
      <div
        className={`flex min-h-0 flex-1 flex-col bg-transparent pb-2 ${stripDim}`}
      >
        <div
          className={`flex min-h-[11rem] min-w-0 flex-1 items-stretch gap-1.5 bg-sky-900/35 sm:min-h-[12rem] ${faderZoneMutedVisual}`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sky-800/35">
            <div className="echo-mixer-fader-slot relative isolate min-h-0 min-w-[5.25rem] flex-1 overflow-hidden bg-sky-800/45 sm:min-w-[6rem]">
              <div
                className="pointer-events-none absolute inset-0 z-0 bg-sky-700/15 shadow-[inset_0_0_28px_rgba(29,78,216,0.28)]"
                aria-hidden
              />
              <MemoMixerFaderRange
                domId={faderDomId}
                name="echoMixerFaderMonitorGain"
                ariaLabel="Ganho do monitor (pipeline)"
                faderValue={faderValue}
                onFaderChange={onFaderChange}
                faderMax={100}
              />
            </div>
          </div>
          <div className="echo-mixer-fader-meter-column flex h-full min-h-0 shrink-0 flex-col">
            <MixerFaderDbScale
              level={vuLevelShown}
              className="min-h-0 w-9 flex-1 sm:w-10"
            />
          </div>
        </div>
        <div className="mt-[3px] bg-transparent pt-1 text-center font-mono text-[11px] font-semibold tabular-nums text-white sm:text-[13px]">
          {faderValue}%
        </div>
        <div className="border-t border-blue-800/40 bg-transparent pt-1.5 text-center font-mono text-xs font-semibold tabular-nums text-sky-100/95">
          5
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 py-1">
        <p
          className={`${MIXER_STRIP_BOTTOM_BADGE_LAYOUT_CLASS} ${mixerChannelStripBadgeToneClassName("monitor", activateOn, muted, faderDisabled)}`}
        >
          Monitor
        </p>
      </div>
    </div>
  );
}
