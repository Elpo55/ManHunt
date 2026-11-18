"use client";
/**
 * Design system — composants de base réutilisables.
 * Règles : cibles tactiles >= 44 px, focus visible, pas de bordures
 * décoratives (les séparations se font par les surfaces).
 */
import { clsx } from "clsx";
import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { GLYPH_PATHS, parseAvatar } from "@/lib/avatars";
import type { Team } from "@/lib/engine/types";

export const cx = clsx;

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-volt text-white hover:bg-[#4a7fff] active:bg-[#2459e0] disabled:bg-slate-2 disabled:text-fog",
  secondary: "bg-slate text-ivory hover:bg-slate-2 active:bg-line disabled:text-fog-2",
  ghost: "bg-transparent text-fog hover:text-ivory hover:bg-slate active:bg-slate-2 disabled:text-fog-2",
  danger: "bg-hunter/12 text-hunter hover:bg-hunter/20 active:bg-hunter/25 disabled:opacity-50",
};
const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[15px] gap-2",
  lg: "h-13 px-5 text-base gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        "inline-flex select-none items-center justify-center rounded-[var(--radius-control)] font-medium transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  block,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  block?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex select-none items-center justify-center rounded-[var(--radius-control)] font-medium transition-colors",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-12 w-full rounded-[var(--radius-control)] bg-slate px-4 text-base text-ivory placeholder:text-fog-2",
        "outline-none ring-1 ring-transparent transition focus:ring-volt",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ivory">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-hunter">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-fog">{hint}</p>
      ) : null}
    </div>
  );
}

export function Panel({
  className,
  children,
  as: As = "section",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
}) {
  return <As className={cx("rounded-[var(--radius-panel)] bg-graphite p-4 sm:p-5", className)}>{children}</As>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-ivory">{children}</h2>
      {action}
    </div>
  );
}

export function Spinner({ label = "Chargement" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-fog">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function FullScreenStatus({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-start justify-center gap-4 px-5 py-16 sm:items-center sm:text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-[var(--radius-control)] px-4 py-3 text-sm",
        tone === "info" && "bg-volt-soft text-ivory",
        tone === "error" && "bg-hunter/12 text-hunter",
        tone === "warn" && "bg-warn/12 text-warn",
      )}
    >
      {children}
    </div>
  );
}

export function Avatar({ avatar, size = 36, className }: { avatar: string | null | undefined; size?: number; className?: string }) {
  const { glyph, color } = parseAvatar(avatar);
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full bg-slate-2", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
        <path d={GLYPH_PATHS[glyph]} />
      </svg>
    </span>
  );
}

export function TeamTag({ team, className }: { team: Team | null; className?: string }) {
  if (!team)
    return <span className={cx("rounded-full bg-slate-2 px-2.5 py-0.5 text-xs text-fog", className)}>Sans équipe</span>;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        team === "hunter" ? "bg-hunter/12 text-hunter" : "bg-fugitive/12 text-fugitive",
        className,
      )}
    >
      <span className={cx("size-1.5 rounded-full", team === "hunter" ? "bg-hunter" : "bg-fugitive")} />
      {team === "hunter" ? "Chasseur" : "Fugitif"}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="num text-2xl text-ivory">{value}</div>
      <div className="text-sm text-fog">{label}</div>
      {sub ? <div className="text-xs text-fog-2">{sub}</div> : null}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-full rounded-[var(--radius-control)] bg-slate p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-10 flex-1 rounded-[8px] px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-slate-2 text-ivory shadow-[inset_0_0_0_1px_var(--line)]" : "text-fog hover:text-ivory",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ivory">{label}</span>
        <span className="num text-sm text-ivory">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ivory [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ivory"
        style={{
          ["--pct" as string]: `${pct}%`,
          background: "transparent",
        }}
      />
      {hint ? <span className="block text-xs text-fog">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-center justify-between gap-4", disabled && "cursor-not-allowed opacity-50")}>
      <span>
        <span className="block text-sm text-ivory">{label}</span>
        {description ? <span className="block text-xs text-fog">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-7 w-12 shrink-0 rounded-full transition-colors", checked ? "bg-volt" : "bg-slate-2")}
      >
        <span
          className={cx(
            "absolute top-1 size-5 rounded-full bg-ivory transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </label>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] bg-graphite px-5 py-8">
      <p className="font-medium text-ivory">{title}</p>
      {children ? <div className="mt-1 text-sm text-fog">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
