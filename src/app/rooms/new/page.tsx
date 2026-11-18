"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, Field, Input, Notice, Panel, RangeField, SectionTitle, Toggle, cx } from "@/components/ui/primitives";
import { ConfigSummary } from "@/components/ConfigEditor";
import { api } from "@/lib/api";
import { DEFAULT_CONFIG, PRESETS, normalizeConfig } from "@/lib/engine/config";
import { toAppError } from "@/lib/errors";
import { getSupabase } from "@/lib/supabase";
import type { GameConfig } from "@/lib/engine/types";

interface Saved {
  id: string;
  name: string;
  config: GameConfig;
}

export default function CreateRoomPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(20);
  const [allowChoice, setAllowChoice] = useState(true);
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [preset, setPreset] = useState<string>("standard");
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.username && !name) setName(`Salon de ${profile.username}`.slice(0, 40));
  }, [profile?.username, name]);

  useEffect(() => {
    getSupabase()
      ?.from("saved_game_configs")
      .select("id,name,config")
      .order("updated_at", { ascending: false })
      .then(({ data }) => setSaved((data as Saved[]) ?? []));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.createRoom(name.trim(), config, maxPlayers, allowChoice);
      router.replace(`/lobby/?room=${r.room_id}`);
    } catch (err) {
      setError(toAppError(err).message);
      setBusy(false);
    }
  }

  const choices = [
    ...PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description, config: normalizeConfig(p.config) })),
    ...saved.map((s) => ({ id: s.id, label: s.name, description: "Configuration enregistrée", config: normalizeConfig(s.config) })),
  ];

  return (
    <AppShell>
      <form onSubmit={submit} className="space-y-5">
        <h1 className="text-2xl font-semibold">Créer un salon</h1>
        <Panel className="space-y-5">
          <Field label="Nom du salon" htmlFor="room-name">
            <Input id="room-name" required minLength={2} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <RangeField label="Joueurs maximum" value={maxPlayers} min={2} max={20} onChange={setMaxPlayers} />
          <Toggle
            label="Les joueurs choisissent leur équipe"
            description="Sinon, vous répartissez les équipes vous-même."
            checked={allowChoice}
            onChange={setAllowChoice}
          />
        </Panel>

        <Panel>
          <SectionTitle>Règles de départ</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={preset === c.id}
                onClick={() => {
                  setPreset(c.id);
                  setConfig(c.config);
                }}
                className={cx(
                  "rounded-[var(--radius-control)] px-4 py-3 text-left transition-colors",
                  preset === c.id ? "bg-volt-soft ring-1 ring-volt" : "bg-slate hover:bg-slate-2",
                )}
              >
                <span className="block font-medium">{c.label}</span>
                <span className="block text-sm text-fog">{c.description}</span>
              </button>
            ))}
          </div>
          <div className="mt-5">
            <ConfigSummary config={config} />
          </div>
          <p className="mt-4 text-sm text-fog">Tous les réglages restent modifiables dans le salon avant le lancement.</p>
        </Panel>

        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" size="lg" block loading={busy}>
          Créer le salon
        </Button>
      </form>
    </AppShell>
  );
}
