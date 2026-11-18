"use client";
/** Dock de contrôle : pas, déplacement pas à pas, capture, radar, capacités. */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crosshair, EyeOff, Footprints, Locate, Radio, ScanSearch, ShieldOff, Waves, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../ui/primitives";
import { ABILITIES, abilitiesFor, availableSteps } from "@/lib/engine/rules";
import type { AbilityKey } from "@/lib/engine/types";
import type { GameState } from "@/lib/game/state";

export const ABILITY_ICON: Record<AbilityKey, ReactNode> = {
  ghost: <EyeOff className="size-5" aria-hidden />,
  jammer: <Waves className="size-5" aria-hidden />,
  sprint: <Zap className="size-5" aria-hidden />,
  scan: <ScanSearch className="size-5" aria-hidden />,
  tracker: <Locate className="size-5" aria-hidden />,
  barrier: <ShieldOff className="size-5" aria-hidden />,
};

export function StepsMeter({ state, now }: { state: GameState; now: number }) {
  const cfg = state.game.config;
  const { steps, nextAt } = availableSteps(state.me, cfg, now);
  const boosted = !!state.me.boost_until && state.me.boost_until > now;
  const regen = boosted ? cfg.step_regen_ms / 2 : cfg.step_regen_ms;
  const progress = nextAt ? 1 - Math.max(0, nextAt - now) / regen : 1;
  return (
    <div className="flex items-center gap-2" aria-label={`${steps} pas disponibles sur ${cfg.max_steps}`}>
      <Footprints className={cx("size-4", boosted ? "text-fugitive" : "text-fog")} aria-hidden />
      <div className="flex gap-1">
        {Array.from({ length: cfg.max_steps }, (_, i) => (
          <span key={i} className="relative h-2.5 w-4 overflow-hidden rounded-full bg-slate-2">
            <span
              className={cx("absolute inset-y-0 left-0 rounded-full", i < steps ? "bg-ivory" : "bg-volt/70")}
              style={{ width: i < steps ? "100%" : i === steps ? `${Math.round(progress * 100)}%` : "0%" }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

export function DPad({ onStep, disabled }: { onStep: (dx: number, dy: number) => void; disabled: boolean }) {
  const btn = "flex size-11 items-center justify-center rounded-[10px] bg-slate text-ivory active:bg-slate-2 disabled:opacity-40";
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Déplacement d'une case">
      <span />
      <button className={btn} disabled={disabled} onClick={() => onStep(0, -1)} aria-label="Nord">
        <ArrowUp className="size-5" />
      </button>
      <span />
      <button className={btn} disabled={disabled} onClick={() => onStep(-1, 0)} aria-label="Ouest">
        <ArrowLeft className="size-5" />
      </button>
      <button className={btn} disabled={disabled} onClick={() => onStep(0, 1)} aria-label="Sud">
        <ArrowDown className="size-5" />
      </button>
      <button className={btn} disabled={disabled} onClick={() => onStep(1, 0)} aria-label="Est">
        <ArrowRight className="size-5" />
      </button>
    </div>
  );
}

function CooldownButton({
  label,
  icon,
  onClick,
  disabled,
  remainingMs,
  totalMs,
  badge,
  tone = "default",
  active,
  loading,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled: boolean;
  remainingMs: number;
  totalMs: number;
  badge?: string;
  tone?: "default" | "hunter" | "fugitive" | "volt";
  active?: boolean;
  loading?: boolean;
}) {
  const cooling = remainingMs > 0;
  const pct = cooling && totalMs > 0 ? remainingMs / totalMs : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || cooling || loading}
      aria-label={cooling ? `${label}, disponible dans ${Math.ceil(remainingMs / 1000)} secondes` : label}
      className={cx(
        "relative flex h-14 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[12px] px-2 text-[11px] transition-colors disabled:cursor-not-allowed",
        active ? "bg-warn/20 text-warn ring-1 ring-warn" : "bg-slate text-ivory hover:bg-slate-2",
        (disabled || cooling) && !active && "text-fog-2",
        tone === "hunter" && !cooling && !disabled && "bg-hunter text-white hover:bg-hunter/90",
        tone === "volt" && !cooling && !disabled && "bg-volt text-white hover:bg-[#4a7fff]",
      )}
    >
      {cooling ? <span className="absolute inset-x-0 bottom-0 bg-white/5" style={{ height: `${pct * 100}%` }} aria-hidden /> : null}
      {icon}
      <span className="relative truncate">{cooling ? `${Math.ceil(remainingMs / 1000)} s` : label}</span>
      {badge ? <span className="num absolute right-1.5 top-1 text-[10px] text-fog">{badge}</span> : null}
    </button>
  );
}

export function ActionBar({
  state,
  now,
  pending,
  targeting,
  onCapture,
  onRadar,
  onAbility,
}: {
  state: GameState;
  now: number;
  pending: string | null;
  targeting: AbilityKey | null;
  onCapture: () => void;
  onRadar: () => void;
  onAbility: (k: AbilityKey) => void;
}) {
  const cfg = state.game.config;
  const running = state.game.phase === "running";
  const active = state.me.status === "active";
  const items: ReactNode[] = [];

  if (state.me.team === "hunter") {
    const total = cfg.capture_cooldown_s * 1000;
    const rem = state.me.last_capture_at ? state.me.last_capture_at + total - now : 0;
    items.push(
      <CooldownButton
        key="capture"
        label="Capturer"
        icon={<Crosshair className="size-5" aria-hidden />}
        onClick={onCapture}
        disabled={!running || !active}
        remainingMs={rem}
        totalMs={total}
        tone="hunter"
        loading={pending === "capture"}
      />,
    );
  }

  const radar = cfg.radar;
  if (radar.enabled && radar.mode === "manual" && (radar.teams === "both" || radar.teams === state.me.team)) {
    const total = radar.cooldown_s * 1000;
    const last = state.game.radar_state.radar_last;
    const uses = state.game.radar_state.radar_uses ?? 0;
    const left = radar.max_uses ? radar.max_uses - uses : null;
    items.push(
      <CooldownButton
        key="radar"
        label="Radar"
        icon={<Radio className="size-5" aria-hidden />}
        onClick={onRadar}
        disabled={!running || !active || left === 0}
        remainingMs={last ? last + total - now : 0}
        totalMs={total}
        badge={left !== null ? String(left) : undefined}
        tone="volt"
        loading={pending === "radar"}
      />,
    );
  }

  for (const meta of abilitiesFor(state.me.team)) {
    const a = cfg.abilities[meta.key];
    if (!a?.enabled) continue;
    const cd = state.cooldowns[meta.key];
    const total = a.cooldown_s * 1000;
    const rem = cd ? cd.last_used_at + total - now : 0;
    const left = a.max_uses ? a.max_uses - (cd?.uses ?? 0) : null;
    const effectOn = cd?.until && cd.until > now;
    items.push(
      <CooldownButton
        key={meta.key}
        label={effectOn ? `${ABILITIES[meta.key].name} ${Math.ceil((cd!.until! - now) / 1000)} s` : meta.name}
        icon={ABILITY_ICON[meta.key]}
        onClick={() => onAbility(meta.key)}
        disabled={!running || !active || left === 0}
        remainingMs={rem}
        totalMs={total}
        badge={left !== null ? String(left) : undefined}
        active={targeting === meta.key}
        loading={pending === `ability:${meta.key}`}
      />,
    );
  }
  return <div className="flex gap-2">{items}</div>;
}
