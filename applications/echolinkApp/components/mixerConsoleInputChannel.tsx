"use client";

import {
  IconMixerPower,
  IconMixerSettings,
  IconMixerTranslation,
  IconMixerVolumeMuted,
  IconMixerVolumeOn,
  MemoMixerFaderRange,
  MixerChannelRoutePairButtons,
  mixerChannelStripBadgeToneClassName,
  mixerChannelStripBorderColorClass,
  MIXER_STRIP_BOTTOM_BADGE_LAYOUT_CLASS,
  MixerFaderDbScale,
  MixerStripTopDragHandle,
  MIXER_TOOLBAR_ICON_CLASS,
  type MixerStripDnDProps,
} from "./mixerConsoleShared";

export type MixerConsoleInputChannelProps = {
  channelId: 1 | 2 | 3;
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
  routeToMaster: boolean;
  routeToMonitor: boolean;
  routeMonitorLocked: boolean;
  onRouteMasterToggle: () => void;
  onRouteMonitorToggle: () => void;
  onOpenTranslation: () => void;
} & MixerStripDnDProps;

export function MixerConsoleInputChannel({
  channelId,
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
  routeToMaster,
  routeToMonitor,
  routeMonitorLocked,
  onRouteMasterToggle,
  onRouteMonitorToggle,
  onOpenTranslation,
  mixerStripId,
  stripStackIndex,
  draggingMixerStripId,
  onMixerStripDragStart,
  onMixerStripDragEnd,
  onMixerStripDragOver,
  onMixerStripDrop,
}: MixerConsoleInputChannelProps) {
  const mixerIconHit =
    "inline-flex w-full min-h-10 items-center justify-center rounded-md border-0 bg-transparent py-1 outline-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-11 sm:py-1.5";
  const vuLevelShown =
    activateOn && !muted && !faderDisabled ? vuLevel : 0;
  const stripDim =
    !activateOn ? "opacity-40" : muted ? "opacity-55" : "";
  const faderZoneMutedVisual =
    faderDisabled && activateOn ? "opacity-[0.55]" : "";
  const chRole =
    channelId === 1
      ? "microfone"
      : channelId === 2
        ? "entrada teams"
        : "entrada mídia";
  const faderDomId = `echo-mixer-fader-ch${channelId}`;
  const faderAria =
    channelId === 1
      ? "Ganho do microfone na mistura"
      : channelId === 2
        ? "Ganho da entrada Teams na mistura"
        : "Ganho da entrada mídia na mistura";
  const mixerFaderTitle =
    channelId === 1 ? "Microfone" : channelId === 2 ? "Teams" : "MÍDIA";
  return (
    <div
      className={`relative isolate box-border flex min-h-0 w-[11.5rem] shrink-0 flex-col overflow-hidden border-l-2 border-solid bg-linear-to-b from-zinc-700/45 via-zinc-800/55 to-zinc-900/80 px-2.5 pb-0 pt-2 sm:w-[13.25rem] sm:px-3 ${mixerChannelStripBorderColorClass("input", activateOn, muted, faderDisabled)} ${draggingMixerStripId === mixerStripId ? "opacity-50" : ""}`}
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
      <p className="mt-[8px] mb-[8px] shrink-0 border-0 bg-transparent px-2 text-center font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 shadow-none ring-0 outline-none sm:text-[11px] sm:tracking-[0.22em]">
        ENTRADA
      </p>
      <div className="mb-1.5 grid min-w-0 shrink-0 grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onActivateToggle}
          title={activateOn ? "Desativar canal" : "Ativar canal"}
          aria-label={
            activateOn
              ? `Desativar canal de ${chRole}`
              : `Ativar canal de ${chRole}`
          }
          className={`${mixerIconHit} ${
            activateOn
              ? "text-emerald-400 drop-shadow-[0_0_14px_rgba(52,211,153,0.45)]"
              : "text-zinc-100"
          }`}
        >
          <IconMixerPower className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onEdit}
          title="Editar dispositivo e tempos"
          aria-label={`Editar definições do canal de ${chRole}`}
          className={`${mixerIconHit} ${
            activateOn ? "text-sky-400" : "text-zinc-600"
          }`}
        >
          <IconMixerSettings className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onMuteToggle}
          title={
            muted && activateOn ? "Restaurar som do canal" : "Silenciar canal"
          }
          aria-label={
            muted && activateOn
              ? `Restaurar som do canal de ${chRole}`
              : `Silenciar canal de ${chRole}`
          }
          className={`${mixerIconHit} ${
            muted && activateOn
              ? "text-red-500 drop-shadow-[0_0_12px_rgba(239,68,68,0.55)]"
              : "text-zinc-500"
          }`}
        >
          {muted && activateOn ? (
            <IconMixerVolumeMuted className={MIXER_TOOLBAR_ICON_CLASS} />
          ) : (
            <IconMixerVolumeOn className={MIXER_TOOLBAR_ICON_CLASS} />
          )}
        </button>
        <button
          type="button"
          disabled={busy || !activateOn}
          onClick={onOpenTranslation}
          title="Tradução de voz"
          aria-label={`Tradução — canal de ${chRole}`}
          className={`${mixerIconHit} ${
            activateOn ? "text-teal-400 drop-shadow-[0_0_10px_rgba(45,212,191,0.35)]" : "text-zinc-600"
          }`}
        >
          <IconMixerTranslation className={MIXER_TOOLBAR_ICON_CLASS} />
        </button>
      </div>
      <p className="mt-[8px] mb-1.5 line-clamp-2 min-h-8 shrink-0 text-center text-[8px] leading-snug text-white sm:text-[9px]">
        {deviceLabel}
      </p>
      <MixerChannelRoutePairButtons
        channelId={channelId}
        routeToMaster={routeToMaster}
        routeToMonitor={routeToMonitor}
        routeMonitorLocked={routeMonitorLocked}
        masterDisabled={busy || !activateOn || faderDisabled}
        monitorDisabled={
          busy || routeMonitorLocked || !activateOn || faderDisabled
        }
        onRouteMasterToggle={onRouteMasterToggle}
        onRouteMonitorToggle={onRouteMonitorToggle}
        wrapperClassName="mb-4"
      />
      <div
        className={`flex min-h-0 flex-1 flex-col bg-transparent pb-2 ${stripDim}`}
      >
        <div
          className={`flex min-h-[11rem] min-w-0 flex-1 items-stretch gap-1.5 bg-zinc-500/50 sm:min-h-[12rem] ${faderZoneMutedVisual}`}
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-zinc-500/45">
            <div className="echo-mixer-fader-slot relative isolate min-h-0 min-w-[5.25rem] flex-1 overflow-hidden bg-zinc-500/55 sm:min-w-[6rem]">
              <div
                className="pointer-events-none absolute inset-0 z-0 shadow-[inset_0_0_24px_rgba(0,0,0,0.22)]"
                aria-hidden
              />
              <MemoMixerFaderRange
                domId={faderDomId}
                name={`echoMixerFaderCh${channelId}`}
                ariaLabel={faderAria}
                faderValue={faderValue}
                onFaderChange={onFaderChange}
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
        <div className="border-t border-zinc-800/50 bg-transparent pt-1.5 text-center font-mono text-xs font-semibold tabular-nums text-zinc-100">
          {channelId}
        </div>
      </div>
      <div className="shrink-0 border-t border-white/10 py-1">
        <p
          className={`${MIXER_STRIP_BOTTOM_BADGE_LAYOUT_CLASS} ${mixerChannelStripBadgeToneClassName("input", activateOn, muted, faderDisabled)}`}
        >
          {mixerFaderTitle}
        </p>
      </div>
    </div>
  );
}
