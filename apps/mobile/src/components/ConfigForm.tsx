/** Règles de partie (hôte) : zone réelle, rythme, GPS, radar, capacités. */
import { ABILITIES, BOUNDS, MODES, PRECISION_LABEL, PRESETS, applyPreset, formatDuration, normalizeConfig, type AbilityKey, type GameConfig } from "@traque/shared";
import { Pressable, View } from "react-native";
import { colors, space } from "../theme";
import { ZonePicker } from "./map/ZonePicker";
import { Panel, SectionTitle, Segmented, Stepper, T, Toggle } from "./ui";

const m = (v: number) => `${v} m`;
const sec = (v: number) => formatDuration(v);

export function ConfigForm({ value, onChange, disabled }: { value: GameConfig; onChange: (c: GameConfig) => void; disabled?: boolean }) {
  const set = (patch: Partial<GameConfig>) => onChange(normalizeConfig({ ...value, ...patch }));
  const setRadar = (patch: Partial<GameConfig["radar"]>) => set({ radar: { ...value.radar, ...patch } });
  const setAbility = (k: AbilityKey, patch: Partial<GameConfig["abilities"][AbilityKey]>) =>
    set({ abilities: { ...value.abilities, [k]: { ...value.abilities[k], ...patch } } });

  return (
    <View style={{ gap: space.lg }}>
      <Panel>
        <SectionTitle>Zone de jeu</SectionTitle>
        <T v="small">{value.zone.set ? value.zone.label : "Choisissez un espace public : parc, quartier piéton…"}</T>
        <ZonePicker value={value.zone} onChange={(z) => set({ zone: z })} disabled={disabled} />
      </Panel>

      <Panel>
        <SectionTitle>Préréglages</SectionTitle>
        {PRESETS.map((p) => (
          <Pressable key={p.id} disabled={disabled} onPress={() => onChange(applyPreset(value, p.id))} style={({ pressed }) => [{ backgroundColor: colors.slate, borderRadius: 12, padding: space.md }, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <T>{p.label}</T>
            <T v="small">{p.description}</T>
          </Pressable>
        ))}
      </Panel>

      <Panel>
        <SectionTitle>Mode</SectionTitle>
        {MODES.map((md) => (
          <Pressable
            key={md.id}
            disabled={disabled || !md.available}
            onPress={() => set({ mode: md.id as GameConfig["mode"] })}
            accessibilityRole="radio"
            accessibilityState={{ checked: value.mode === md.id, disabled: !md.available }}
            style={[{ borderRadius: 12, padding: space.md, backgroundColor: value.mode === md.id ? colors.voltSoft : colors.slate, opacity: md.available ? 1 : 0.45 }]}
          >
            <T>{md.label}{md.available ? "" : " — prochainement"}</T>
            <T v="small">{md.summary}</T>
          </Pressable>
        ))}
      </Panel>

      <Panel>
        <SectionTitle>Temps</SectionTitle>
        <Stepper label="Durée" value={value.duration_s} {...BOUNDS.duration_s} format={sec} disabled={disabled} onChange={(v) => set({ duration_s: v })} />
        <Stepper label="Préparation" value={value.prep_s} {...BOUNDS.prep_s} format={(v) => (v ? sec(v) : "Aucune")} disabled={disabled} onChange={(v) => set({ prep_s: v })} hint="Les Fugitifs se dispersent ; les Chasseurs ne les voient pas encore." />
      </Panel>

      <Panel>
        <SectionTitle>Positions</SectionTitle>
        <T v="small">Révélation des adversaires</T>
        <Segmented
          value={value.enemy_reveal}
          disabled={disabled}
          onChange={(v) => set({ enemy_reveal: v })}
          options={[
            { value: "live", label: "Régulière" },
            { value: "pulse", label: "Par impulsions" },
          ]}
        />
        {value.enemy_reveal === "live" ? (
          <Stepper label="Actualisation des adversaires" value={value.enemy_refresh_s} {...BOUNDS.enemy_refresh_s} format={sec} disabled={disabled} onChange={(v) => set({ enemy_refresh_s: v })} />
        ) : null}
        <Stepper label="Précision montrée aux adversaires" value={value.approx_m} {...BOUNDS.approx_m} format={m} disabled={disabled} onChange={(v) => set({ approx_m: v })} hint="Jamais plus précise que le GPS réel du joueur." />
        <Stepper label="Envoi de ma position" value={value.position_interval_s} {...BOUNDS.position_interval_s} format={sec} disabled={disabled} onChange={(v) => set({ position_interval_s: v })} hint="Plus espacé = moins de batterie." />
        <Stepper label="Position obsolète après" value={value.stale_after_s} {...BOUNDS.stale_after_s} format={sec} disabled={disabled} onChange={(v) => set({ stale_after_s: v })} />
      </Panel>

      <Panel>
        <SectionTitle>Captures et sécurité</SectionTitle>
        <Stepper label="Rayon de capture" value={value.capture_radius_m} {...BOUNDS.capture_radius_m} format={m} disabled={disabled} onChange={(v) => set({ capture_radius_m: v })} hint="Aucun contact physique : la capture se fait par proximité GPS." />
        <Stepper label="Précision GPS exigée" value={value.max_accuracy_m} {...BOUNDS.max_accuracy_m} format={m} disabled={disabled} onChange={(v) => set({ max_accuracy_m: v })} />
        <Stepper label="Recharge de capture" value={value.capture_cooldown_s} {...BOUNDS.capture_cooldown_s} format={sec} disabled={disabled} onChange={(v) => set({ capture_cooldown_s: v })} />
        <Stepper label="Vitesse maximale crédible" value={value.max_speed_mps} {...BOUNDS.max_speed_mps} format={(v) => `${Math.round(v * 3.6)} km/h`} disabled={disabled} onChange={(v) => set({ max_speed_mps: v })} hint="Au-delà, la position est refusée (véhicule, triche)." />
        <Stepper label="Hors zone toléré" value={value.out_of_zone_grace_s} {...BOUNDS.out_of_zone_grace_s} format={sec} disabled={disabled} onChange={(v) => set({ out_of_zone_grace_s: v })} />
        <Stepper label="Abandon après déconnexion" value={value.disconnect_grace_s} {...BOUNDS.disconnect_grace_s} format={sec} disabled={disabled} onChange={(v) => set({ disconnect_grace_s: v })} />
      </Panel>

      <Panel>
        <SectionTitle>Radar</SectionTitle>
        <Toggle label="Radar actif" value={value.radar.enabled} disabled={disabled} onChange={(v) => setRadar({ enabled: v })} />
        {value.radar.enabled ? (
          <>
            <Segmented value={value.radar.mode} disabled={disabled} onChange={(v) => setRadar({ mode: v })} options={[{ value: "auto", label: "Automatique" }, { value: "manual", label: "Manuel" }]} />
            <Segmented
              value={value.radar.teams}
              disabled={disabled}
              onChange={(v) => setRadar({ teams: v })}
              options={[{ value: "hunter", label: "Chasseurs" }, { value: "fugitive", label: "Fugitifs" }, { value: "both", label: "Les deux" }]}
            />
            <Segmented
              value={value.radar.precision}
              disabled={disabled}
              onChange={(v) => setRadar({ precision: v })}
              options={[{ value: "direction", label: "Direction" }, { value: "sector", label: "Secteur" }, { value: "zone", label: "Zone" }]}
            />
            <T v="small">{PRECISION_LABEL[value.radar.precision]}.</T>
            {value.radar.mode === "auto" ? (
              <Stepper label="Intervalle" value={value.radar.interval_s} {...BOUNDS.radar_interval_s} format={sec} disabled={disabled} onChange={(v) => setRadar({ interval_s: v })} />
            ) : (
              <>
                <Stepper label="Recharge" value={value.radar.cooldown_s} {...BOUNDS.radar_cooldown_s} format={sec} disabled={disabled} onChange={(v) => setRadar({ cooldown_s: v })} />
                <Stepper label="Utilisations" value={value.radar.max_uses} {...BOUNDS.radar_max_uses} format={(v) => (v ? String(v) : "Illimitées")} disabled={disabled} onChange={(v) => setRadar({ max_uses: v })} />
              </>
            )}
            <Stepper label="Affichage d'un résultat" value={value.radar.reveal_s} {...BOUNDS.radar_reveal_s} format={sec} disabled={disabled} onChange={(v) => setRadar({ reveal_s: v })} />
          </>
        ) : null}
      </Panel>

      <Panel>
        <SectionTitle>Capacités</SectionTitle>
        {(Object.keys(ABILITIES) as AbilityKey[]).map((k) => (
          <Toggle
            key={k}
            label={ABILITIES[k].name}
            description={`${ABILITIES[k].team === "hunter" ? "Chasseurs" : "Fugitifs"} · ${ABILITIES[k].short} · recharge ${formatDuration(value.abilities[k].cooldown_s)}`}
            value={value.abilities[k].enabled}
            disabled={disabled}
            onChange={(v) => setAbility(k, { enabled: v })}
          />
        ))}
      </Panel>
    </View>
  );
}
