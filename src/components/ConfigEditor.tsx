"use client";
/** Éditeur des règles de partie (hôte). Valeurs bornées comme côté serveur. */
import { BOUNDS, PRESETS, normalizeConfig } from "@/lib/engine/config";
import { ABILITIES, MODES, PRECISION_LABEL, TEAM_LABEL, formatDuration } from "@/lib/engine/rules";
import type { AbilityKey, GameConfig, Team } from "@/lib/engine/types";
import { Panel, RangeField, Segmented, SectionTitle, Toggle, cx } from "./ui/primitives";

export function ConfigEditor({
  value,
  onChange,
  disabled,
}: {
  value: GameConfig;
  onChange: (c: GameConfig) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<GameConfig>) => onChange(normalizeConfig({ ...value, ...patch }));
  const setRadar = (patch: Partial<GameConfig["radar"]>) => set({ radar: { ...value.radar, ...patch } });
  const setAbility = (key: AbilityKey, patch: Partial<GameConfig["abilities"][AbilityKey]>) =>
    set({ abilities: { ...value.abilities, [key]: { ...value.abilities[key], ...patch } } });
  const seconds = (v: number) => formatDuration(v);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle>Préréglages</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(normalizeConfig({ ...p.config, abilities: value.abilities, mode: value.mode }))}
              className="rounded-[var(--radius-control)] bg-slate px-4 py-3 text-left transition-colors hover:bg-slate-2 disabled:opacity-50"
            >
              <span className="block font-medium">{p.label}</span>
              <span className="block text-sm text-fog">{p.description}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Mode de jeu</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={disabled || !m.available}
              aria-pressed={value.mode === m.id}
              onClick={() => m.available && set({ mode: m.id as GameConfig["mode"] })}
              className={cx(
                "rounded-[var(--radius-control)] px-4 py-3 text-left transition-colors disabled:cursor-not-allowed",
                value.mode === m.id ? "bg-volt-soft ring-1 ring-volt" : "bg-slate hover:bg-slate-2",
                !m.available && "opacity-45",
              )}
            >
              <span className="flex items-center justify-between font-medium">
                {m.label}
                {!m.available ? <span className="text-xs font-normal text-fog">Prochainement</span> : null}
              </span>
              <span className="mt-0.5 block text-sm text-fog">{m.summary}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel className="space-y-4">
        <SectionTitle>Temps et carte</SectionTitle>
        <RangeField label="Durée de la traque" value={value.duration_s} {...BOUNDS.duration_s} format={seconds} disabled={disabled} onChange={(v) => set({ duration_s: v })} />
        <RangeField label="Préparation (les Fugitifs se cachent)" value={value.prep_s} {...BOUNDS.prep_s} format={(v) => (v ? seconds(v) : "Aucune")} disabled={disabled} onChange={(v) => set({ prep_s: v })} />
        <div className="space-y-2">
          <span className="text-sm">Taille de la carte</span>
          <Segmented
            label="Taille de la carte"
            value={value.map_size}
            disabled={disabled}
            onChange={(v) => set({ map_size: v })}
            options={[
              { value: "s", label: "Petite 16²" },
              { value: "m", label: "Moyenne 22²" },
              { value: "l", label: "Grande 30²" },
            ]}
          />
        </div>
        <RangeField label="Densité de bâtiments" value={value.obstacle_density} {...BOUNDS.obstacle_density} format={(v) => `${Math.round(v * 100)} %`} disabled={disabled} onChange={(v) => set({ obstacle_density: v })} />
        <Toggle label="Zones interdites" description="Secteurs infranchissables générés sur la carte." checked={value.forbidden_zones} disabled={disabled} onChange={(v) => set({ forbidden_zones: v })} />
      </Panel>

      <Panel className="space-y-4">
        <SectionTitle>Déplacements et captures</SectionTitle>
        <RangeField label="Réserve de pas" value={value.max_steps} {...BOUNDS.max_steps} disabled={disabled} onChange={(v) => set({ max_steps: v })} hint="Nombre maximum de cases parcourues d'un coup." />
        <RangeField label="Régénération d'un pas" value={value.step_regen_ms} {...BOUNDS.step_regen_ms} format={(v) => `${(v / 1000).toFixed(v % 1000 ? 2 : 0)} s`} disabled={disabled} onChange={(v) => set({ step_regen_ms: v })} />
        <RangeField label="Vision des Chasseurs" value={value.vision_hunter} {...BOUNDS.vision_hunter} format={(v) => `${v} case${v > 1 ? "s" : ""}`} disabled={disabled} onChange={(v) => set({ vision_hunter: v })} />
        <RangeField label="Vision des Fugitifs" value={value.vision_fugitive} {...BOUNDS.vision_fugitive} format={(v) => `${v} case${v > 1 ? "s" : ""}`} disabled={disabled} onChange={(v) => set({ vision_fugitive: v })} />
        <RangeField label="Portée de capture" value={value.capture_range} {...BOUNDS.capture_range} format={(v) => (v === 0 ? "Même case" : `${v} case${v > 1 ? "s" : ""}`)} disabled={disabled} onChange={(v) => set({ capture_range: v })} />
        <RangeField label="Recharge de capture" value={value.capture_cooldown_s} {...BOUNDS.capture_cooldown_s} format={seconds} disabled={disabled} onChange={(v) => set({ capture_cooldown_s: v })} />
        <RangeField label="Abandon après déconnexion" value={value.disconnect_grace_s} {...BOUNDS.disconnect_grace_s} format={seconds} disabled={disabled} onChange={(v) => set({ disconnect_grace_s: v })} />
        <RangeField label="Part de Chasseurs (répartition auto)" value={value.hunter_ratio} {...BOUNDS.hunter_ratio} format={(v) => `${Math.round(v * 100)} %`} disabled={disabled} onChange={(v) => set({ hunter_ratio: v })} />
      </Panel>

      <Panel className="space-y-4">
        <SectionTitle>Radar</SectionTitle>
        <Toggle label="Radar actif" checked={value.radar.enabled} disabled={disabled} onChange={(v) => setRadar({ enabled: v })} />
        {value.radar.enabled ? (
          <>
            <div className="space-y-2">
              <span className="text-sm">Déclenchement</span>
              <Segmented label="Déclenchement" value={value.radar.mode} disabled={disabled} onChange={(v) => setRadar({ mode: v })} options={[{ value: "auto", label: "Automatique" }, { value: "manual", label: "Manuel" }]} />
            </div>
            <div className="space-y-2">
              <span className="text-sm">Équipes équipées</span>
              <Segmented
                label="Équipes équipées"
                value={value.radar.teams}
                disabled={disabled}
                onChange={(v) => setRadar({ teams: v })}
                options={[
                  { value: "hunter", label: TEAM_LABEL.hunter },
                  { value: "fugitive", label: TEAM_LABEL.fugitive },
                  { value: "both", label: "Les deux" },
                ] as { value: Team | "both"; label: string }[]}
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm">Précision</span>
              <Segmented
                label="Précision"
                value={value.radar.precision}
                disabled={disabled}
                onChange={(v) => setRadar({ precision: v })}
                options={(["direction", "sector", "zone"] as const).map((p) => ({ value: p, label: PRECISION_LABEL[p].split(" ")[0] }))}
              />
              <p className="text-xs text-fog">{PRECISION_LABEL[value.radar.precision]}.</p>
            </div>
            {value.radar.mode === "auto" ? (
              <RangeField label="Intervalle entre impulsions" value={value.radar.interval_s} {...BOUNDS.radar_interval_s} format={seconds} disabled={disabled} onChange={(v) => setRadar({ interval_s: v })} />
            ) : (
              <>
                <RangeField label="Recharge (par équipe)" value={value.radar.cooldown_s} {...BOUNDS.radar_cooldown_s} format={seconds} disabled={disabled} onChange={(v) => setRadar({ cooldown_s: v })} />
                <RangeField label="Utilisations par équipe" value={value.radar.max_uses} {...BOUNDS.radar_max_uses} format={(v) => (v ? String(v) : "Illimité")} disabled={disabled} onChange={(v) => setRadar({ max_uses: v })} />
              </>
            )}
            <RangeField label="Durée d'affichage d'un résultat" value={value.radar.reveal_s} {...BOUNDS.radar_reveal_s} format={seconds} disabled={disabled} onChange={(v) => setRadar({ reveal_s: v })} />
          </>
        ) : null}
      </Panel>

      <Panel className="space-y-1">
        <SectionTitle>Capacités</SectionTitle>
        {(Object.keys(ABILITIES) as AbilityKey[]).map((key) => {
          const meta = ABILITIES[key];
          const a = value.abilities[key];
          return (
            <details key={key} className="group rounded-[var(--radius-control)] bg-slate px-4 py-1 open:pb-4">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">{meta.name}</span>
                  <span className={cx("block text-xs", meta.team === "hunter" ? "text-hunter" : "text-fugitive")}>
                    {TEAM_LABEL[meta.team]} · {meta.short}
                  </span>
                </span>
                <span className="text-xs text-fog">{a.enabled ? "Active" : "Désactivée"}</span>
              </summary>
              <div className="space-y-3 pt-2">
                <Toggle label="Disponible dans la partie" checked={a.enabled} disabled={disabled} onChange={(v) => setAbility(key, { enabled: v })} />
                {a.enabled ? (
                  <>
                    {key !== "tracker" ? (
                      <RangeField label="Durée" value={a.duration_s} {...BOUNDS.ability_duration_s} format={seconds} disabled={disabled} onChange={(v) => setAbility(key, { duration_s: v })} />
                    ) : null}
                    <RangeField label="Recharge" value={a.cooldown_s} {...BOUNDS.ability_cooldown_s} format={seconds} disabled={disabled} onChange={(v) => setAbility(key, { cooldown_s: v })} />
                    <RangeField label="Utilisations" value={a.max_uses} {...BOUNDS.ability_max_uses} format={(v) => (v ? String(v) : "Illimité")} disabled={disabled} onChange={(v) => setAbility(key, { max_uses: v })} />
                  </>
                ) : null}
              </div>
            </details>
          );
        })}
      </Panel>
    </div>
  );
}

/** Résumé court d'une configuration (lobby). */
export function ConfigSummary({ config }: { config: GameConfig }) {
  const c = config;
  const items = [
    ["Mode", MODES.find((m) => m.id === c.mode)?.label ?? c.mode],
    ["Durée", formatDuration(c.duration_s)],
    ["Préparation", c.prep_s ? formatDuration(c.prep_s) : "Aucune"],
    ["Carte", { s: "Petite", m: "Moyenne", l: "Grande" }[c.map_size]],
    [
      "Radar",
      c.radar.enabled
        ? `${c.radar.mode === "auto" ? `toutes les ${formatDuration(c.radar.interval_s)}` : "manuel"} · ${PRECISION_LABEL[c.radar.precision].toLowerCase()}`
        : "désactivé",
    ],
    ["Capacités", `${Object.values(c.abilities).filter((a) => a.enabled).length} sur 6`],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-fog">{k}</dt>
          <dd className="text-sm text-ivory">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
